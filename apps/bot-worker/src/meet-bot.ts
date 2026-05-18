import { chromium, Page } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';

async function main() {
  const meetingUrl = process.env.MEETING_URL;
  const meetingId = process.env.MEETING_ID;
  const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL;

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
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await page.goto(meetingUrl);

    try {
      const gotItButton = page.getByText('Got it');
      if (await gotItButton.isVisible({ timeout: 5000 })) {
        await gotItButton.click();
      }
    } catch (e) {}

    const nameInput = page.getByPlaceholder('Your name');
    await nameInput.waitFor({ state: 'visible', timeout: 30000 });
    await nameInput.fill('AI Notetaker');

    const joinButton = page.getByRole('button', { name: /Ask to join|Join now/i });
    await joinButton.click();

    await page.waitForSelector('[data-participant-id]', { state: 'attached', timeout: 120000 });
    
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

    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame() && !frame.url().includes(meetingUrl)) {
        await handleEnd(browser, ws, meetingId, ffmpeg);
      }
    });

    const interval = setInterval(async () => {
      try {
        const count = await page.locator('[data-participant-id]').count();
        if (count === 0) {
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

main();
