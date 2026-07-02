import os
from dotenv import load_dotenv
load_dotenv()
import json
import asyncio
import uuid
import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from tenacity import retry, stop_after_attempt, wait_exponential  # noqa: F401 (kept for future use)
from langchain.prompts import PromptTemplate
from langchain.chains.combine_documents.map_reduce import MapReduceDocumentsChain
from langchain.chains.combine_documents.reduce import ReduceDocumentsChain
from langchain.chains.combine_documents.stuff import StuffDocumentsChain
from langchain.chains.llm import LLMChain
from langchain.text_splitter import TokenTextSplitter
from langchain.docstore.document import Document

JSON_OUTPUT_FORMAT = """
{
  "overview": "One paragraph high-level summary of the entire meeting",
  "speakerSummaries": [
    {
      "speaker": "Speaker 0",
      "summary": "What this person discussed during the meeting",
      "decisions": "The key decisions, opinions, or conclusions this person expressed"
    }
  ],
  "actionItems": [
    {"owner": "Speaker 0", "task": "Specific task they need to complete", "dueDate": "Timeline if mentioned, otherwise null"}
  ]
}
"""

SINGLE_PROMPT_TMPL = """
You are a professional meeting assistant. Analyze the following transcript and output ONLY valid JSON matching this exact structure:
{json_format}

Rules:
- Include one entry in speakerSummaries for each unique speaker in the transcript.
- Each speakerSummaries entry must capture what that specific person said and what decisions or opinions they expressed.
- actionItems should consolidate all tasks and commitments mentioned by any speaker.
- Output ONLY the JSON object, no markdown fences, no extra text.

Transcript:
{text}
"""

MAP_PROMPT_TMPL = """
Analyze the following transcript section. For each speaker, note what they discussed, their decisions or opinions, and any action items they mentioned.
Transcript section:
{text}
"""

REDUCE_PROMPT_TMPL = """
You are a professional meeting assistant. You are given several summaries of sections from a single meeting.
Combine them into one cohesive summary and output ONLY valid JSON matching this exact structure:
{json_format}

Rules:
- Merge entries for the same speaker across sections into a single speakerSummaries entry.
- actionItems should consolidate all tasks across all sections.
- Output ONLY the JSON object, no markdown fences, no extra text.

Summaries:
{text}
"""

def _candidate_llms():
    """Return a list of (label, llm) to try in order. No probing — fail on actual use."""
    groq_key = os.getenv("GROQ_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    candidates = []

    if groq_key and not groq_key.startswith("placeholder") and groq_key.strip():
        from langchain_groq import ChatGroq
        for model in ["llama-3.3-70b-versatile", "llama3-70b-8192", "mixtral-8x7b-32768"]:
            candidates.append((f"groq/{model}", ChatGroq(model=model, temperature=0.1, groq_api_key=groq_key)))

    if anthropic_key and not anthropic_key.startswith("placeholder") and anthropic_key.strip():
        from langchain_anthropic import ChatAnthropic
        candidates.append(("claude-haiku-4-5-20251001", ChatAnthropic(model_name="claude-haiku-4-5-20251001", temperature=0.1, anthropic_api_key=anthropic_key)))

    if gemini_key and not gemini_key.startswith("placeholder") and gemini_key.strip():
        from langchain_google_genai import ChatGoogleGenerativeAI
        for model in ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.0-pro"]:
            candidates.append((f"gemini/{model}", ChatGoogleGenerativeAI(model=model, temperature=0.1, google_api_key=gemini_key)))

    if not candidates:
        raise ValueError("No AI API key configured (GROQ_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY)")
    return candidates


async def generate_summary(transcript_text: str):
    candidates = _candidate_llms()
    last_err = None

    for label, llm in candidates:
        try:
            print(f"[ai-summarizer] Trying model: {label}")
            token_splitter = TokenTextSplitter(chunk_size=5000, chunk_overlap=200)
            docs = [Document(page_content=transcript_text)]
            split_docs = token_splitter.split_documents(docs)

            if len(split_docs) == 1:
                prompt = PromptTemplate.from_template(SINGLE_PROMPT_TMPL).partial(json_format=JSON_OUTPUT_FORMAT)
                chain = prompt | llm
                result = await chain.ainvoke({"text": transcript_text})
                print(f"[ai-summarizer] Summary generated with {label}")
                return result.content
            else:
                map_prompt = PromptTemplate.from_template(MAP_PROMPT_TMPL)
                map_chain = LLMChain(llm=llm, prompt=map_prompt)
                reduce_prompt = PromptTemplate.from_template(REDUCE_PROMPT_TMPL).partial(json_format=JSON_OUTPUT_FORMAT)
                reduce_chain = LLMChain(llm=llm, prompt=reduce_prompt)
                combine_docs_chain = StuffDocumentsChain(llm_chain=reduce_chain, document_variable_name="text")
                reduce_documents_chain = ReduceDocumentsChain(
                    combine_documents_chain=combine_docs_chain,
                    collapse_documents_chain=combine_docs_chain,
                    token_max=6000,
                )
                map_reduce_chain = MapReduceDocumentsChain(
                    llm_chain=map_chain,
                    reduce_documents_chain=reduce_documents_chain,
                    document_variable_name="text",
                    return_intermediate_steps=False,
                )
                result = await map_reduce_chain.arun(split_docs)
                print(f"[ai-summarizer] Summary generated with {label}")
                return result
        except Exception as e:
            err_str = str(e).lower()
            if any(k in err_str for k in ["quota", "429", "exhausted", "not found", "404", "notfound", "resourceexhausted"]):
                print(f"[ai-summarizer] {label} unavailable ({type(e).__name__}), trying next model...")
                last_err = e
                continue
            raise

    raise last_err or ValueError("All models exhausted")


async def mark_meeting_done(db_pool, meeting_id: str, summary_id: str, summary_data: dict):
    """Insert summary and mark meeting DONE."""
    async with db_pool.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO "Summary" (id, "meetingId", overview, "keyDecisions", "actionItems", participants, "createdAt")
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW())
            ON CONFLICT ("meetingId") DO UPDATE
              SET overview = EXCLUDED.overview,
                  "keyDecisions" = EXCLUDED."keyDecisions",
                  "actionItems" = EXCLUDED."actionItems",
                  participants = EXCLUDED.participants,
                  "createdAt" = NOW()
            ''',
            summary_id,
            meeting_id,
            summary_data.get("overview", ""),
            json.dumps(summary_data.get("keyDecisions", [])),
            json.dumps(summary_data.get("actionItems", [])),
            json.dumps(summary_data.get("speakerSummaries", [])),
        )
        await conn.execute(
            '''
            UPDATE "Meeting"
            SET status = 'DONE', "endTime" = NOW(), "updatedAt" = NOW()
            WHERE id = $1
            ''',
            meeting_id,
        )


async def mark_meeting_failed(db_pool, meeting_id: str, reason: str):
    """Mark meeting as DONE with a placeholder summary indicating no data."""
    print(f"[ai-summarizer] Marking meeting {meeting_id} as DONE with empty summary: {reason}")
    try:
        async with db_pool.acquire() as conn:
            # Still insert a summary record so the UI shows something
            summary_id = str(uuid.uuid4())
            placeholder = {
                "overview": f"No transcript available. {reason}",
                "keyDecisions": [],
                "actionItems": [],
                "participants": [],
            }
            await conn.execute(
                '''
                INSERT INTO "Summary" (id, "meetingId", overview, "keyDecisions", "actionItems", participants, "createdAt")
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW())
                ON CONFLICT ("meetingId") DO NOTHING
                ''',
                summary_id,
                meeting_id,
                placeholder["overview"],
                json.dumps(placeholder["keyDecisions"]),
                json.dumps(placeholder["actionItems"]),
                json.dumps(placeholder["participants"]),
            )
            await conn.execute(
                '''
                UPDATE "Meeting"
                SET status = 'DONE', "endTime" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                ''',
                meeting_id,
            )
    except Exception as e:
        print(f"[ai-summarizer] Could not mark meeting {meeting_id} done: {e}")


def _merge_transcript(raw: str) -> str:
    """Merge consecutive same-speaker lines into paragraphs for better LLM comprehension."""
    merged = []
    current_speaker = None
    current_words = []

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("[") and "]" in line:
            bracket_end = line.index("]")
            speaker = line[1:bracket_end]
            text = line[bracket_end + 1:].strip()
        else:
            speaker = "Speaker"
            text = line

        if speaker == current_speaker:
            current_words.append(text)
        else:
            if current_speaker is not None and current_words:
                merged.append(f"[{current_speaker}] {' '.join(current_words)}")
            current_speaker = speaker
            current_words = [text]

    if current_speaker and current_words:
        merged.append(f"[{current_speaker}] {' '.join(current_words)}")

    return "\n".join(merged)


async def main():
    import ssl
    kafka_brokers = os.getenv("KAFKA_BROKERS", "localhost:9092")
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    db_url = os.getenv("DATABASE_URL")

    sasl_username = os.getenv("KAFKA_SASL_USERNAME")
    sasl_password = os.getenv("KAFKA_SASL_PASSWORD")
    sasl_mechanism = os.getenv("KAFKA_SASL_MECHANISM", "SCRAM-SHA-256").upper()

    kafka_kwargs = {}
    if sasl_username and sasl_password:
        kafka_kwargs["security_protocol"] = "SASL_SSL"
        kafka_kwargs["sasl_mechanism"] = sasl_mechanism
        kafka_kwargs["sasl_plain_username"] = sasl_username
        kafka_kwargs["sasl_plain_password"] = sasl_password
        kafka_kwargs["ssl_context"] = ssl.create_default_context()

    consumer = AIOKafkaConsumer(
        "meeting.ended",
        bootstrap_servers=kafka_brokers,
        group_id="ai-summarizer-group",
        **kafka_kwargs,
    )

    # Retry connecting to Kafka/Redis/DB with backoff — handles slow broker startup
    for attempt in range(1, 11):
        try:
            producer = AIOKafkaProducer(bootstrap_servers=kafka_brokers, **kafka_kwargs)
            redis_client = redis.from_url(redis_url)
            await redis_client.ping()
            db_pool = await asyncpg.create_pool(db_url, statement_cache_size=0)

            await consumer.start()
            await producer.start()
            print("[ai-summarizer] Listening for meeting.ended events...")
            break
        except Exception as e:
            wait = min(5 * attempt, 60)
            print(f"[ai-summarizer] Startup attempt {attempt}/10 failed: {e} — retrying in {wait}s")
            await asyncio.sleep(wait)
    else:
        print("[ai-summarizer] ERROR: Could not connect after 10 attempts — exiting so Docker restarts the service")
        raise SystemExit(1)

    try:
        async for msg in consumer:
            data = json.loads(msg.value.decode("utf-8"))
            meeting_id = data["meetingId"]
            print(f"[ai-summarizer] Processing meeting {meeting_id}")

            # Fetch transcript from Redis
            transcript_bytes = await redis_client.get(f"transcript:{meeting_id}")
            if not transcript_bytes:
                print(f"[ai-summarizer] No transcript found for meeting {meeting_id} — marking done with empty summary")
                await mark_meeting_failed(db_pool, meeting_id, "Bot joined but no speech was captured.")
                continue

            transcript_text = _merge_transcript(transcript_bytes.decode("utf-8").strip())
            if len(transcript_text) < 20:
                print(f"[ai-summarizer] Transcript too short for meeting {meeting_id}: '{transcript_text}'")
                await mark_meeting_failed(db_pool, meeting_id, "Meeting was too short to summarize.")
                continue

            print(f"[ai-summarizer] Transcript length: {len(transcript_text)} chars — generating summary...")

            # Save raw transcript to DB so the UI can show it
            try:
                segments = []
                for line in transcript_text.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("[") and "]" in line:
                        bracket_end = line.index("]")
                        speaker = line[1:bracket_end]
                        text = line[bracket_end + 1:].strip()
                    else:
                        speaker = "Speaker"
                        text = line
                    segments.append({"speaker": speaker, "text": text, "startMs": 0, "endMs": 0})

                async with db_pool.acquire() as conn:
                    await conn.execute(
                        '''
                        INSERT INTO "Transcript" (id, "meetingId", content, "wordCount", "createdAt")
                        VALUES ($1, $2, $3::jsonb, $4, NOW())
                        ON CONFLICT ("meetingId") DO UPDATE
                          SET content = EXCLUDED.content,
                              "wordCount" = EXCLUDED."wordCount"
                        ''',
                        str(uuid.uuid4()),
                        meeting_id,
                        json.dumps(segments),
                        sum(len(s["text"].split()) for s in segments),
                    )
                print(f"[ai-summarizer] ✅ Transcript saved ({len(segments)} segments) for {meeting_id}")
            except Exception as e:
                print(f"[ai-summarizer] Warning: could not save transcript for {meeting_id}: {e}")

            try:
                raw_summary = await generate_summary(transcript_text)
            except Exception as e:
                print(f"[ai-summarizer] Summary generation failed for {meeting_id}: {e}")
                await mark_meeting_failed(db_pool, meeting_id, f"Summary generation error: {e}")
                continue

            # Clean markdown fences that LLMs sometimes add
            clean_json = raw_summary.replace("```json", "").replace("```", "").strip()

            try:
                summary_data = json.loads(clean_json)
            except json.JSONDecodeError as e:
                print(f"[ai-summarizer] Failed to parse LLM JSON for {meeting_id}: {e}\nRaw: {clean_json[:300]}")
                # Try to salvage by wrapping in a placeholder
                summary_data = {
                    "overview": clean_json[:1000],
                    "keyDecisions": [],
                    "actionItems": [],
                    "participants": [],
                }

            summary_id = str(uuid.uuid4())
            await mark_meeting_done(db_pool, meeting_id, summary_id, summary_data)

            await producer.send_and_wait(
                "summary.ready",
                json.dumps({"meetingId": meeting_id, "summaryId": summary_id}).encode("utf-8"),
            )
            print(f"[ai-summarizer] ✅ Summary ready for meeting {meeting_id}")

    finally:
        await consumer.stop()
        await producer.stop()
        await redis_client.close()
        await db_pool.close()

if __name__ == "__main__":
    asyncio.run(main())
