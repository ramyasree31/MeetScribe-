import os
import boto3
import asyncio
from concurrent.futures import ThreadPoolExecutor

s3_client = boto3.client(
    's3',
    region_name=os.getenv("AWS_REGION", "us-east-1")
)

S3_BUCKET = os.getenv("AWS_S3_BUCKET_NAME")

async def upload_audio_to_s3(meeting_id: str, raw_pcm_path: str):
    if not S3_BUCKET:
        print("AWS_S3_BUCKET_NAME not set, skipping S3 upload.")
        return

    # 1. Convert raw PCM to MP3 using ffmpeg
    mp3_path = f"/tmp/{meeting_id}.mp3"
    
    # We use -y to overwrite if exists, -f s16le for raw PCM 16-bit little-endian
    process = await asyncio.create_subprocess_exec(
        'ffmpeg', '-y', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', raw_pcm_path, mp3_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    await process.communicate()

    # 2. Upload to S3 in a separate thread to avoid blocking the event loop
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor() as pool:
        await loop.run_in_executor(
            pool,
            lambda: s3_client.upload_file(mp3_path, S3_BUCKET, f"recordings/{meeting_id}.mp3")
        )
    
    print(f"Successfully uploaded {meeting_id}.mp3 to S3 bucket {S3_BUCKET}")
    
    # 3. Cleanup local files
    try:
        os.remove(raw_pcm_path)
        os.remove(mp3_path)
    except OSError:
        pass
