import os
import json
import asyncio
import uuid
import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from tenacity import retry, stop_after_attempt, wait_exponential
from langchain_anthropic import ChatAnthropic
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
    llm = ChatAnthropic(
        model_name="claude-sonnet-4-20250514", 
        temperature=0.1, 
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY")
    )
    
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
            token_max=6000
        )
        
        map_reduce_chain = MapReduceDocumentsChain(
            llm_chain=map_chain,
            reduce_documents_chain=reduce_documents_chain,
            document_variable_name="text",
            return_intermediate_steps=False
        )
        
        result = await map_reduce_chain.arun(split_docs)
        return result

async def main():
    kafka_brokers = os.getenv("KAFKA_BROKERS", "localhost:9092")
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    db_url = os.getenv("DATABASE_URL")
    
    consumer = AIOKafkaConsumer(
        "meeting.ended",
        bootstrap_servers=kafka_brokers,
        group_id="ai-summarizer-group"
    )
    producer = AIOKafkaProducer(bootstrap_servers=kafka_brokers)
    redis_client = redis.from_url(redis_url)
    db_pool = await asyncpg.create_pool(db_url)
    
    await consumer.start()
    await producer.start()
    
    print("AI Summarizer listening for meeting.ended events...")
    
    try:
        async for msg in consumer:
            data = json.loads(msg.value.decode("utf-8"))
            meeting_id = data["meetingId"]
            
            transcript_bytes = await redis_client.get(f"transcript:{meeting_id}")
            if not transcript_bytes:
                continue
                
            transcript_text = transcript_bytes.decode("utf-8")
            raw_summary = await generate_summary(transcript_text)
            clean_json = raw_summary.replace("```json", "").replace("```", "").strip()
            
            try:
                summary_data = json.loads(clean_json)
            except json.JSONDecodeError as e:
                print(f"Failed to parse LLM JSON output: {e}")
                continue
            
            summary_id = str(uuid.uuid4())
            async with db_pool.acquire() as conn:
                await conn.execute('''
                    INSERT INTO "Summary" (id, "meetingId", overview, "actionItems", participants, "createdAt")
                    VALUES ($1, $2, $3, $4, $5, NOW())
                ''', 
                summary_id, 
                meeting_id, 
                summary_data.get("overview", ""), 
                json.dumps(summary_data.get("actionItems", [])), 
                json.dumps(summary_data.get("participants", [])))
            
            await producer.send_and_wait(
                "summary.ready",
                json.dumps({"meetingId": meeting_id, "summaryId": summary_id}).encode("utf-8")
            )
            print(f"Successfully processed summary for meeting {meeting_id}")
            
    finally:
        await consumer.stop()
        await producer.stop()
        await redis_client.close()
        await db_pool.close()

if __name__ == "__main__":
    asyncio.run(main())
