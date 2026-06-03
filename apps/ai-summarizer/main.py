import os
from dotenv import load_dotenv
load_dotenv()
import json
import asyncio
import uuid
import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from tenacity import retry, stop_after_attempt, wait_exponential
from langchain.prompts import PromptTemplate
from langchain.chains.combine_documents.map_reduce import MapReduceDocumentsChain
from langchain.chains.combine_documents.reduce import ReduceDocumentsChain
from langchain.chains.combine_documents.stuff import StuffDocumentsChain
from langchain.chains.llm import LLMChain
from langchain.text_splitter import TokenTextSplitter
from langchain.docstore.document import Document

JSON_OUTPUT_FORMAT = """
{
  "overview": "High level summary of the meeting",
  "keyDecisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {"owner": "Speaker 1", "task": "Complete the report", "dueDate": "Next Tuesday"}
  ],
  "participants": [
    {"label": "Speaker 1", "role": "Project Manager"}
  ]
}
"""

SINGLE_PROMPT_TMPL = """
You are a professional meeting assistant. Analyze the following transcript and output ONLY valid JSON matching this exact structure:
{json_format}

Transcript:
{text}
"""

MAP_PROMPT_TMPL = """
Analyze the following transcript section and extract key discussions, decisions, action items, and participants.
Transcript section:
{text}
"""

REDUCE_PROMPT_TMPL = """
You are a professional meeting assistant. You are given several summaries of sections from a single meeting.
Combine them into one cohesive summary and output ONLY valid JSON matching this exact structure:
{json_format}

Summaries:
{text}
"""

@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=4, max=60))
async def generate_summary(transcript_text: str):
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")

    if anthropic_key and not anthropic_key.startswith("placeholder") and anthropic_key.strip():
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(
            model_name="claude-sonnet-4-20250514",
            temperature=0.1,
            anthropic_api_key=anthropic_key,
        )
        print("[ai-summarizer] Using Anthropic Claude for summary generation")
    elif gemini_key and not gemini_key.startswith("placeholder") and gemini_key.strip():
        from langchain_google_genai import ChatGoogleGenerativeAI
        llm = ChatGoogleGenerativeAI(
            model="gemini-1.5-flash",
            temperature=0.1,
            google_api_key=gemini_key,
        )
        print("[ai-summarizer] Using Google Gemini for summary generation")
    else:
        raise ValueError("Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is configured")

    token_splitter = TokenTextSplitter(chunk_size=5000, chunk_overlap=200)
    docs = [Document(page_content=transcript_text)]
    split_docs = token_splitter.split_documents(docs)

    if len(split_docs) == 1:
        prompt = PromptTemplate.from_template(SINGLE_PROMPT_TMPL).partial(json_format=JSON_OUTPUT_FORMAT)
        chain = prompt | llm
        result = await chain.ainvoke({"text": transcript_text})
        return result.content
    else:
        map_prompt = PromptTemplate.from_template(MAP_PROMPT_TMPL)
        map_chain = LLMChain(llm=llm, prompt=map_prompt)

        reduce_prompt = PromptTemplate.from_template(REDUCE_PROMPT_TMPL).partial(json_format=JSON_OUTPUT_FORMAT)
        reduce_chain = LLMChain(llm=llm, prompt=reduce_prompt)

        combine_docs_chain = StuffDocumentsChain(
            llm_chain=reduce_chain, document_variable_name="text"
        )
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
        return result


async def mark_meeting_done(db_pool, meeting_id: str, summary_id: str, summary_data: dict):
    """Insert summary and mark meeting DONE."""
    async with db_pool.acquire() as conn:
        await conn.execute(
            '''
            INSERT INTO "Summary" (id, "meetingId", overview, "keyDecisions", "actionItems", participants, "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
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
            json.dumps(summary_data.get("participants", [])),
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
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
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

    try:
        producer = AIOKafkaProducer(bootstrap_servers=kafka_brokers, **kafka_kwargs)
        redis_client = redis.from_url(redis_url)
        await redis_client.ping()
        db_pool = await asyncpg.create_pool(db_url, statement_cache_size=0)

        await consumer.start()
        await producer.start()
        print("[ai-summarizer] Listening for meeting.ended events...")
    except Exception as e:
        print(f"[ai-summarizer] WARNING: Kafka/Redis/DB could not start, running in standby: {e}")
        while True:
            await asyncio.sleep(3600)

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

            transcript_text = transcript_bytes.decode("utf-8").strip()
            if len(transcript_text) < 20:
                print(f"[ai-summarizer] Transcript too short for meeting {meeting_id}: '{transcript_text}'")
                await mark_meeting_failed(db_pool, meeting_id, "Meeting was too short to summarize.")
                continue

            print(f"[ai-summarizer] Transcript length: {len(transcript_text)} chars — generating summary...")

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
