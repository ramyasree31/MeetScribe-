import os
from dotenv import load_dotenv
load_dotenv()
import json
import asyncio
import aiofiles
import struct
import math
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents
from aiokafka import AIOKafkaProducer
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
deepgram_client = DeepgramClient(os.getenv("DEEPGRAM_API_KEY", ""))


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
    print(f"[audio-processor] Bot connected for meeting {meeting_id} — waiting for audio")

    raw_pcm_path = f"/tmp/{meeting_id}.raw"
    audio_file = await aiofiles.open(raw_pcm_path, mode="wb")

    meeting_ended_emitted = False
    loop = asyncio.get_event_loop()

    # Speaker tracking — built by correlating Deepgram IDs with active-speaker events from bot
    current_active_speaker: str = ""          # name currently speaking (from browser energy)
    speaker_id_to_name: dict[int, str] = {}   # Deepgram speaker int → display name
    participant_roster: list[str] = []        # ordered list from participants panel

    async def save_speaker_names():
        if redis_client and speaker_id_to_name:
            mapping = {f"Speaker {k}": v for k, v in speaker_id_to_name.items()}
            await redis_client.set(f"speaker_names:{meeting_id}", json.dumps(mapping))
            print(f"[audio-processor] Speaker map saved: {mapping}")

    # Deepgram connection — created lazily on first audio frame to avoid timeout
    dg_connection = None
    dg_started = False
    transcript_count = 0

    # Actual sample rate reported by the browser AudioContext.
    # Default 16000; overridden by 'audio_config' event before first audio frame.
    configured_sample_rate = 16000

    def open_deepgram():
        nonlocal dg_connection, dg_started

        options = LiveOptions(
            model="nova-2",
            language="en",
            smart_format=True,
            punctuate=True,
            diarize=True,
            interim_results=True,
            utterance_end_ms="1200",   # wait 1.2s silence before finalising segment
            vad_events=True,
            encoding="linear16",
            channels=1,
            sample_rate=configured_sample_rate,
        )
        print(f"[audio-processor] Opening Deepgram with sampleRate={configured_sample_rate}")

        conn = deepgram_client.listen.live.v("1")

        def on_message(self, result, **kwargs):
            nonlocal transcript_count
            transcript_count += 1

            is_final = result.is_final
            try:
                text_raw = result.channel.alternatives[0].transcript
            except Exception:
                text_raw = ""

            if transcript_count <= 5 or transcript_count % 20 == 0:
                print(f"[audio-processor] dg callback #{transcript_count} is_final={is_final} text={repr(text_raw[:60])}")

            if not is_final:
                return

            words = result.channel.alternatives[0].words
            if not words:
                return

            text = result.channel.alternatives[0].transcript
            if not text.strip():
                return

            # Skip single-word fragments — wait for Deepgram to accumulate more context
            if len(words) < 3:
                return

            speaker = words[0].speaker if hasattr(words[0], "speaker") else 0
            start_ms = int(words[0].start * 1000)
            end_ms = int(words[-1].end * 1000)

            # Map Deepgram numeric ID → real name using active-speaker correlation
            if speaker not in speaker_id_to_name:
                if current_active_speaker:
                    speaker_id_to_name[speaker] = current_active_speaker
                    print(f"[audio-processor] Mapped Speaker {speaker} → \"{current_active_speaker}\"")
                elif participant_roster:
                    # Fallback: assign by order of first appearance
                    idx = len(speaker_id_to_name)
                    if idx < len(participant_roster):
                        speaker_id_to_name[speaker] = participant_roster[idx]

            display_name = speaker_id_to_name.get(speaker, f"Speaker {speaker}")
            print(f"[audio-processor] TRANSCRIPT {display_name}: {repr(text)}")

            segment = {
                "meetingId": meeting_id,
                "speaker": display_name,
                "text": text,
                "startMs": start_ms,
                "endMs": end_ms,
            }

            async def _send(seg=segment, spk=speaker, name=display_name):
                if kafka_producer:
                    try:
                        await kafka_producer.send_and_wait(
                            "transcript.segments",
                            json.dumps(seg).encode("utf-8"),
                        )
                    except Exception as e:
                        print(f"[audio-processor] Kafka send error: {e}")
                if redis_client:
                    try:
                        await redis_client.append(
                            f"transcript:{meeting_id}",
                            f"[{name}] {seg['text']}\n",
                        )
                    except Exception as e:
                        print(f"[audio-processor] Redis append error: {e}")

            asyncio.run_coroutine_threadsafe(_send(), loop)

        def on_error(self, error, **kwargs):
            nonlocal dg_started
            print(f"[audio-processor] Deepgram error for {meeting_id}: {error}")
            dg_started = False  # signal main loop to reopen connection

        def on_close(self, close, **kwargs):
            print(f"[audio-processor] Deepgram connection closed for {meeting_id}")

        conn.on(LiveTranscriptionEvents.Transcript, on_message)
        conn.on(LiveTranscriptionEvents.Error, on_error)
        conn.on(LiveTranscriptionEvents.Close, on_close)

        started = conn.start(options)
        print(f"[audio-processor] Deepgram opened on first audio, started={started} for {meeting_id}")
        dg_connection = conn
        dg_started = started
        return started

    def frame_rms(frame_bytes: bytes) -> float:
        n = len(frame_bytes) // 2
        if n == 0:
            return 0.0
        samples = struct.unpack(f'{n}h', frame_bytes[:n * 2])
        return math.sqrt(sum(s * s for s in samples) / n)

    try:
        buffer = b""
        total_bytes = 0
        frames_sent = 0
        FRAME_SIZE = 320 * 3        # 30 ms at 16 kHz mono s16le
        SILENCE_RMS = 150           # int16 RMS below this = silence (≈ -46 dBFS)

        while True:
            data = await websocket.receive()

            if "text" in data:
                try:
                    msg = json.loads(data["text"])
                except json.JSONDecodeError:
                    continue

                event = msg.get("event")

                if event == "meeting_ended":
                    print(f"[audio-processor] Received meeting_ended for {meeting_id}")
                    meeting_ended_emitted = True
                    await save_speaker_names()
                    await emit_meeting_ended(meeting_id)
                    break

                elif event == "audio_config":
                    new_rate = msg.get("sampleRate", 16000)
                    if dg_connection is None:
                        configured_sample_rate = int(new_rate)
                        print(f"[audio-processor] Sample rate set to {configured_sample_rate} Hz")
                    else:
                        print(f"[audio-processor] audio_config arrived after Deepgram already opened (rate={new_rate}) — ignored")
                    continue

                elif event == "speaker_active":
                    current_active_speaker = msg.get("name", "")
                    continue

                elif event == "participant_names":
                    names = msg.get("names", [])
                    if names:
                        participant_roster.clear()
                        participant_roster.extend(names)
                        print(f"[audio-processor] Participant roster: {names}")
                        for i, name in enumerate(names):
                            if i not in speaker_id_to_name:
                                speaker_id_to_name[i] = name
                        await save_speaker_names()
                    continue

                continue

            if "bytes" in data:
                raw = data["bytes"]
                await audio_file.write(raw)
                buffer += raw
                total_bytes += len(raw)

                while len(buffer) >= FRAME_SIZE:
                    frame = buffer[:FRAME_SIZE]
                    buffer = buffer[FRAME_SIZE:]

                    # Before Deepgram opens: skip silent frames so we don't open
                    # the connection on muted tracks (avoids NET0001 early timeout).
                    if dg_connection is None:
                        if frame_rms(frame) < SILENCE_RMS:
                            continue
                        ok = open_deepgram()
                        if not ok:
                            print(f"[audio-processor] Deepgram failed to start for {meeting_id} — dropping audio")
                            continue

                    # After Deepgram opens: reopen on disconnect, then send ALL frames
                    # (including silence) so Deepgram stays alive during speech pauses.
                    if not dg_started:
                        print(f"[audio-processor] Reopening Deepgram after disconnect for {meeting_id}")
                        dg_connection = None
                        if frame_rms(frame) < SILENCE_RMS:
                            continue
                        ok = open_deepgram()
                        if not ok:
                            continue

                    dg_connection.send(frame)
                    frames_sent += 1
                    if frames_sent == 1 or frames_sent % 200 == 0:
                        print(f"[audio-processor] {meeting_id}: {frames_sent} frames → Deepgram ({total_bytes} bytes total)")

    except WebSocketDisconnect:
        print(f"[audio-processor] WebSocket disconnected for {meeting_id} — emitting meeting.ended")
    except Exception as e:
        print(f"[audio-processor] Unexpected error for {meeting_id}: {e}")
    finally:
        await audio_file.close()
        if dg_connection is not None:
            dg_connection.finish()

        await save_speaker_names()
        if not meeting_ended_emitted:
            await emit_meeting_ended(meeting_id)

        asyncio.create_task(upload_audio_to_s3(meeting_id, raw_pcm_path))
