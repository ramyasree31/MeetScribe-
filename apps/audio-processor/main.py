import os
from dotenv import load_dotenv
load_dotenv()
import json
import asyncio
import aiofiles
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents
from aiokafka import AIOKafkaProducer
import webrtcvad
import redis.asyncio as redis

# ── Optional S3 upload (non-fatal if not configured) ─────────────────────────
try:
    from s3 import upload_audio_to_s3 as _upload_audio_to_s3
    _has_s3 = True
except ImportError:
    _has_s3 = False

async def upload_audio_to_s3(meeting_id: str, path: str):
    if _has_s3:
        try:
            await _upload_audio_to_s3(meeting_id, path)
        except Exception as e:
            print(f"[audio-processor] S3 upload failed (non-fatal): {e}")
    else:
        print("[audio-processor] S3 module not available — skipping upload")

# ── Globals ───────────────────────────────────────────────────────────────────
kafka_producer: AIOKafkaProducer = None
redis_client: redis.Redis = None
vad = webrtcvad.Vad(3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global kafka_producer, redis_client

    import ssl
    kafka_brokers = os.getenv("KAFKA_BROKERS", "localhost:9092")

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

    try:
        kafka_producer = AIOKafkaProducer(bootstrap_servers=kafka_brokers, **kafka_kwargs)
        await kafka_producer.start()
        print("Kafka connected successfully")
    except Exception as e:
        print(f"WARNING: Kafka could not start, running in mock/isolated mode: {e}")
        kafka_producer = None

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        redis_client = redis.from_url(redis_url)
        await redis_client.ping()
        print("Redis connected successfully")
    except Exception as e:
        print(f"WARNING: Redis could not start, running in mock/isolated mode: {e}")
        redis_client = None

    yield

    if kafka_producer:
        try:
            await kafka_producer.stop()
        except Exception:
            pass
    if redis_client:
        try:
            await redis_client.close()
        except Exception:
            pass

app = FastAPI(lifespan=lifespan)
deepgram = DeepgramClient(os.getenv("DEEPGRAM_API_KEY", ""))


async def emit_meeting_ended(meeting_id: str):
    """Emit the meeting.ended Kafka event so the summarizer fires."""
    if kafka_producer:
        try:
            await kafka_producer.send_and_wait(
                "meeting.ended",
                json.dumps({"meetingId": meeting_id}).encode("utf-8"),
            )
            print(f"[audio-processor] Emitted meeting.ended for {meeting_id}")
        except Exception as e:
            print(f"[audio-processor] Failed to emit meeting.ended: {e}")


@app.websocket("/ws/{meeting_id}")
async def websocket_endpoint(websocket: WebSocket, meeting_id: str):
    await websocket.accept()

    dg_connection = deepgram.listen.live.v("1")
    raw_pcm_path = f"/tmp/{meeting_id}.raw"

    audio_file = await aiofiles.open(raw_pcm_path, mode="wb")

    # Track if we already fired meeting.ended (avoid double-emitting)
    meeting_ended_emitted = False

    # ── Deepgram transcript callback ─────────────────────────────────────────
    # NOTE: Deepgram's live.on() calls this in a sync context via a thread-pool.
    # We schedule the async work back on the main event loop.
    loop = asyncio.get_event_loop()

    def on_message(self, result, **kwargs):
        if not result.is_final:
            return

        words = result.channel.alternatives[0].words
        if not words:
            return

        text = result.channel.alternatives[0].transcript
        if not text.strip():
            return

        speaker = words[0].speaker if hasattr(words[0], "speaker") else 0
        start_ms = int(words[0].start * 1000)
        end_ms = int(words[-1].end * 1000)

        segment = {
            "meetingId": meeting_id,
            "speaker": f"Speaker {speaker}",
            "text": text,
            "startMs": start_ms,
            "endMs": end_ms,
        }

        # Schedule async work onto the event loop from this sync callback
        async def _send():
            if kafka_producer:
                try:
                    await kafka_producer.send_and_wait(
                        "transcript.segments",
                        json.dumps(segment).encode("utf-8"),
                    )
                except Exception as e:
                    print(f"[audio-processor] Kafka send error: {e}")
            if redis_client:
                try:
                    await redis_client.append(
                        f"transcript:{meeting_id}",
                        f"[Speaker {speaker}] {text}\n",
                    )
                except Exception as e:
                    print(f"[audio-processor] Redis append error: {e}")

        asyncio.run_coroutine_threadsafe(_send(), loop)

    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)

    options = LiveOptions(
        model="nova-2",
        language="en",
        smart_format=True,
        diarize=True,
        interim_results=True,
        encoding="linear16",
        channels=1,
        sample_rate=16000,
    )

    if not dg_connection.start(options):
        await audio_file.close()
        await websocket.close()
        return

    try:
        buffer = b""
        FRAME_SIZE = 320 * 3  # 30 ms at 16 kHz mono s16le

        while True:
            data = await websocket.receive()

            if "text" in data:
                try:
                    msg = json.loads(data["text"])
                except json.JSONDecodeError:
                    continue

                if msg.get("event") == "meeting_ended":
                    print(f"[audio-processor] Received meeting_ended signal for {meeting_id}")
                    meeting_ended_emitted = True
                    await emit_meeting_ended(meeting_id)
                    break
                continue

            if "bytes" in data:
                raw = data["bytes"]
                await audio_file.write(raw)
                buffer += raw

                while len(buffer) >= FRAME_SIZE:
                    frame = buffer[:FRAME_SIZE]
                    buffer = buffer[FRAME_SIZE:]
                    try:
                        is_speech = vad.is_speech(frame, 16000)
                    except Exception:
                        is_speech = False
                    if is_speech:
                        dg_connection.send(frame)

    except WebSocketDisconnect:
        # Bot disconnected (crash, meeting end, container stop, etc.)
        # Still emit meeting.ended so summarizer runs.
        print(f"[audio-processor] WebSocket disconnected for {meeting_id} — emitting meeting.ended")
    except Exception as e:
        print(f"[audio-processor] Unexpected error for {meeting_id}: {e}")
    finally:
        await audio_file.close()
        dg_connection.finish()

        # Always emit meeting.ended if we haven't yet
        if not meeting_ended_emitted:
            await emit_meeting_ended(meeting_id)

        # Upload raw audio to S3 in background (non-blocking)
        asyncio.create_task(upload_audio_to_s3(meeting_id, raw_pcm_path))
