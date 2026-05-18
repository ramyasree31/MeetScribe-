import { chromium, Page } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';

export async function runZoomBot() {
  const meetingUrl = process.env.MEETING_URL;
  const meetingId = process.env.MEETING_ID;
  const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL;
  const zoomPasscode = process.env.ZOOM_PASSCODE || '';

  if (!meetingUrl || !meetingId || !audioProcessorUrl) {
    throw new Error('Missing required environment variables');
  }

  const ws = new WebSocket(`${audioProcessorUrl}/ws/${meetingId}`);

  try {
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const browser = await chromium.launch({
      headless: false,
      args: [
        '--use-fake-ui-for-media-stream',
        '--disable-web-security',
        '--disable-infobars',
        '--hide-scrollbars',
        '--window-size=1280,720',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    page.on('dialog', async dialog => await dialog.accept());

    // Navigate to Zoom Web Client URL (convert standard zoom.us/j/ to zoom.us/wc/join/)
    let webClientUrl = meetingUrl;
    if (meetingUrl.includes('/j/')) {
      webClientUrl = meetingUrl.replace('/j/', '/wc/join/');
    }
    
    await page.goto(webClientUrl);

    // 1. Handle Cookie Banner
    try {
      const acceptCookies = page.getByRole('button', { name: /Accept Cookies|Agree/i });
      if (await acceptCookies.isVisible({ timeout: 5000 })) {
        await acceptCookies.click();
      }
    } catch (e) {}

    // 2. Fill Name and Passcode (if required)
    const nameInput = page.getByPlaceholder('Your Name');
    await nameInput.waitFor({ state: 'visible', timeout: 30000 });
    await nameInput.fill('AI Notetaker');

    if (zoomPasscode) {
      const passcodeInput = page.getByPlaceholder('Meeting Passcode');
      if (await passcodeInput.isVisible({ timeout: 3000 })) {
        await passcodeInput.fill(zoomPasscode);
      }
    }

    const joinButton = page.getByRole('button', { name: 'Join' });
    await joinButton.click();

    // 3. Wait for Waiting Room or direct admission
    // "Please wait, the meeting host will let you in soon."
    // We wait until the main meeting controls appear (e.g. "Leave" button or "Mute" button)
    await page.waitForSelector('button[aria-label^="Leave"], button[aria-label^="Mute"]', { state: 'attached', timeout: 300000 });
    
    // 4. Click "Join Audio by Computer" if prompted
    try {
      const joinAudioBtn = page.getByRole('button', { name: /Join Audio by Computer/i });
      if (await joinAudioBtn.isVisible({ timeout: 10000 })) {
        await joinAudioBtn.click();
      }
    } catch (e) {}

    // Send PCM Audio over WS
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'pulse',
      '-i', 'default',
      '-ar', '16000',
      '-ac', '1',
      '-f', 's16le',
      '-'
    ]);

    ffmpeg.stdout.on('data', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Detect meeting end (e.g., host ended meeting)
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame() && frame.url().includes('postattendee')) {
        await handleEnd(browser, ws, meetingId, ffmpeg);
      }
    });

    // Fallback: Check if controls disappeared
    const interval = setInterval(async () => {
      try {
        const leaveBtn = await page.locator('button[aria-label^="Leave"]').count();
        if (leaveBtn === 0) {
          clearInterval(interval);
          await handleEnd(browser, ws, meetingId, ffmpeg);
        }
      } catch (e) {}
    }, 5000);

  } catch (error: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'bot_error', reason: error.message }));
    }
    process.exit(1);
  }
}

async function handleEnd(browser: any, ws: WebSocket, meetingId: string, ffmpeg: any) {
  ffmpeg.kill('SIGINT');
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
  }
  await browser.close();
  process.exit(0);
}
