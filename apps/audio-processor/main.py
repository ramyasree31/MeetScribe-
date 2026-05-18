import os
import json
import asyncio
import aiofiles
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents
from aiokafka import AIOKafkaProducer
import webrtcvad
import redis.asyncio as redis
from s3 import upload_audio_to_s3

# Globals
kafka_producer: AIOKafkaProducer = None
redis_client: redis.Redis = None
vad = webrtcvad.Vad(3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global kafka_producer, redis_client
    
    kafka_brokers = os.getenv("KAFKA_BROKERS", "localhost:9092")
    kafka_producer = AIOKafkaProducer(bootstrap_servers=kafka_brokers)
    await kafka_producer.start()
    
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    redis_client = redis.from_url(redis_url)
    
    yield
    
    await kafka_producer.stop()
    await redis_client.close()

app = FastAPI(lifespan=lifespan)
deepgram = DeepgramClient(os.getenv("DEEPGRAM_API_KEY", ""))

@app.websocket("/ws/{meeting_id}")
async def websocket_endpoint(websocket: WebSocket, meeting_id: str):
    await websocket.accept()
    
    dg_connection = deepgram.listen.asyncwebsocket.v("1")
    raw_pcm_path = f"/tmp/{meeting_id}.raw"
    
    # Open the raw audio file to save the stream
    audio_file = await aiofiles.open(raw_pcm_path, mode='wb')
    
    async def on_message(self, result, **kwargs):
        if not result.is_final:
            return
            
        words = result.channel.alternatives[0].words
        if not words:
            return
            
        text = result.channel.alternatives[0].transcript
        if not text.strip():
            return
            
        speaker = words[0].speaker if hasattr(words[0], 'speaker') else "Speaker 0"
        start_ms = int(words[0].start * 1000)
        end_ms = int(words[-1].end * 1000)
        
        segment = {
            "meetingId": meeting_id,
            "speaker": f"Speaker {speaker}",
            "text": text,
            "startMs": start_ms,
            "endMs": end_ms
        }
        
        await kafka_producer.send_and_wait(
            "transcript.segments", 
            json.dumps(segment).encode('utf-8')
        )
        
        await redis_client.append(f"transcript:{meeting_id}", f"[{speaker}] {text}\n")

    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
    
    options = LiveOptions(
        model="nova-2",
        language="en",
        smart_format=True,
        diarize=True,
        interim_results=True,
        encoding="linear16",
        channels=1,
        sample_rate=16000
    )
    
    if not await dg_connection.start(options):
        await audio_file.close()
        await websocket.close()
        return

    try:
        buffer = b""
        FRAME_SIZE = 320 * 3 # 30ms chunks
        
        while True:
            data = await websocket.receive()
            if "text" in data:
                msg = json.loads(data["text"])
                if msg.get("event") == "meeting_ended":
                    await kafka_producer.send_and_wait(
                        "meeting.ended", 
                        json.dumps({"meetingId": meeting_id}).encode('utf-8')
                    )
                    break
                continue
                
            if "bytes" in data:
                # Write raw bytes to disk for S3 upload later
                await audio_file.write(data["bytes"])
                
                buffer += data["bytes"]
                
                while len(buffer) >= FRAME_SIZE:
                    frame = buffer[:FRAME_SIZE]
                    buffer = buffer[FRAME_SIZE:]
                    
                    is_speech = vad.is_speech(frame, 16000)
                    if is_speech:
                        await dg_connection.send(frame)
                        
    except WebSocketDisconnect:
        pass
    finally:
        await audio_file.close()
        await dg_connection.finish()
        # Fire and forget S3 upload task
        asyncio.create_task(upload_audio_to_s3(meeting_id, raw_pcm_path))
