import { chromium } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isSignInPage(url: string): boolean {
  return (
    url.includes('login.microsoftonline.com') ||
    url.includes('login.live.com') ||
    url.includes('account.microsoft.com') ||
    url.includes('/signin')
  );
}

async function saveScreenshot(page: import('playwright').Page, filename: string): Promise<void> {
  try {
    await page.screenshot({ path: filename, fullPage: true });
    console.log(`[teams-bot] Screenshot saved: ${filename}`);
  } catch (err) {
    console.error(`[teams-bot] Failed to save screenshot "${filename}":`, (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function runTeamsBot() {
  const meetingUrl       = process.env.MEETING_URL;
  const meetingId        = process.env.MEETING_ID;
  const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001';
  const botName          = process.env.BOT_NAME || 'AI Notetaker';

  if (!meetingUrl || !meetingId) {
    console.error('[teams-bot] Missing MEETING_URL or MEETING_ID');
    process.exit(1);
  }

  console.log(`[teams-bot] Starting for meeting ${meetingId} → ${meetingUrl}`);

  // ─── Non-blocking WebSocket connection ────────────────────────────────────
  const ws = new WebSocket(`${audioProcessorUrl}/ws/${meetingId}`);
  let wsReady = false;

  ws.on('open', () => {
    wsReady = true;
    console.log('[teams-bot] Audio processor WebSocket connected');
  });
  ws.on('error', (err) => {
    console.warn('[teams-bot] Audio processor WS error (continuing without it):', err.message);
  });

  // ─── Launch Chromium ───────────────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--disable-infobars',
      '--hide-scrollbars',
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    permissions: ['microphone', 'camera'],
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const page = await context.newPage();
  page.on('dialog', async (dialog) => { await dialog.accept(); });

  // ─── Build the web-client URL ─────────────────────────────────────────────
  // Microsoft Teams meeting links can be:
  //   https://teams.microsoft.com/l/meetup-join/...
  //   https://teams.live.com/meet/...  (Teams for personal use)
  // We open them directly in the browser web client by adding ?clientType=nativeMeetupJoinClientType
  // and redirecting to the web client explicitly.
  let webUrl = meetingUrl;

  // Force web client — avoids the "Open Teams app" redirect prompt
  if (meetingUrl.includes('teams.microsoft.com')) {
    if (!meetingUrl.includes('clientType')) {
      webUrl = `${meetingUrl}${meetingUrl.includes('?') ? '&' : '?'}clientType=nativeMeetupJoinClientType`;
    }
  }

  console.log(`[teams-bot] Navigating to: ${webUrl}`);
  try {
    await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    console.error('[teams-bot] Navigation failed:', (err as Error).message);
    await saveScreenshot(page, 'screenshot-teams-nav-error.png');
    await browser.close();
    process.exit(1);
  }

  await sleep(3000);

  // ─── Handle sign-in wall — try guest bypass ───────────────────────────────
  if (isSignInPage(page.url())) {
    console.log('[teams-bot] Redirected to Microsoft sign-in — attempting guest bypass...');
    const bypassed = await tryTeamsGuestBypass(page, webUrl);
    if (!bypassed) {
      console.error('[teams-bot] Could not bypass Microsoft sign-in.');
      await saveScreenshot(page, 'screenshot-teams-signin.png');
      await browser.close();
      process.exit(1);
    }
    await sleep(3000);
  }

  // ─── Click "Continue on this browser" to skip the app-download prompt ─────
  try {
    const continueBrowser = page.getByRole('button', { name: /continue on this browser|continue in browser/i });
    if (await continueBrowser.isVisible({ timeout: 8000 })) {
      await continueBrowser.click();
      console.log('[teams-bot] Clicked "Continue on this browser"');
      await sleep(2000);
    }
  } catch (_) {}

  // Also try the link variant
  try {
    const continueLink = page.getByRole('link', { name: /continue on this browser|join on the web instead/i });
    if (await continueLink.isVisible({ timeout: 4000 })) {
      await continueLink.click();
      console.log('[teams-bot] Clicked "Join on the web" link');
      await sleep(2000);
    }
  } catch (_) {}

  // ─── Dismiss cookie/GDPR banners ──────────────────────────────────────────
  for (const label of [/accept all/i, /accept/i, /agree/i, /got it/i, /dismiss/i]) {
    try {
      const btn = page.getByRole('button', { name: label }).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await sleep(400);
      }
    } catch (_) {}
  }

  // ─── Fill name (guest pre-join screen) ────────────────────────────────────
  const nameSelectors = [
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
    'input[aria-label="Type your name"]',
    'input[data-tid="prejoin-input-name"]',
    '#displayName',
  ];

  let nameFilled = false;
  for (const selector of nameSelectors) {
    try {
      const input = page.locator(selector).first();
      const timeout = selector === nameSelectors[0] ? 25000 : 3000;
      await input.waitFor({ state: 'visible', timeout });
      await input.clear();
      await input.fill(botName);
      console.log(`[teams-bot] Filled name: ${botName}`);
      nameFilled = true;
      break;
    } catch (_) {}
  }

  if (!nameFilled) {
    console.warn('[teams-bot] Could not find name input — proceeding without filling name');
  }

  // ─── Turn off camera/mic on pre-join (optional but avoids permission dialogs)
  for (const label of [/turn off.*camera/i, /turn off.*video/i, /disable.*camera/i]) {
    try {
      const btn = page.getByRole('button', { name: label });
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
      }
    } catch (_) {}
  }

  // ─── Click Join button ────────────────────────────────────────────────────
  const joinLabels = [
    /join now/i,
    /join meeting/i,
    /ask to join/i,
    /^join$/i,
    /join as a guest/i,
  ];

  let joined = false;
  for (const label of joinLabels) {
    try {
      const btn = page.getByRole('button', { name: label }).first();
      if (await btn.isVisible({ timeout: 8000 })) {
        await btn.click();
        console.log(`[teams-bot] Clicked join button`);
        joined = true;
        break;
      }
    } catch (_) {}
  }

  if (!joined) {
    console.error('[teams-bot] Could not find join button');
    await saveScreenshot(page, 'screenshot-teams-no-join.png');
    await browser.close();
    process.exit(1);
  }

  // ─── Wait to be admitted ──────────────────────────────────────────────────
  console.log('[teams-bot] Waiting to be admitted to the Teams meeting...');
  try {
    await Promise.race([
      // In-meeting controls
      page.waitForSelector('[data-tid="hangup-button"]',                { timeout: 180000 }),
      page.waitForSelector('[aria-label="Leave"]',                      { timeout: 180000 }),
      page.waitForSelector('[aria-label*="leave" i]',                   { timeout: 180000 }),
      page.waitForSelector('[data-tid="call-controls-container"]',      { timeout: 180000 }),
      // Participant roster visible
      page.waitForSelector('[data-tid="roster-button"]',                { timeout: 180000 }),
    ]);
    console.log('[teams-bot] Joined the Teams meeting ✅');
  } catch (err) {
    console.error('[teams-bot] Timed out waiting to join:', (err as Error).message);
    await saveScreenshot(page, 'screenshot-teams-admit.png');
    await browser.close();
    process.exit(1);
  }

  // ─── Start audio capture ───────────────────────────────────────────────────
  let ffmpeg: ReturnType<typeof spawn> | null = null;

  if (wsReady || ws.readyState === WebSocket.CONNECTING) {
    if (ws.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5000);
        ws.once('open', () => { clearTimeout(t); resolve(); });
        ws.once('error', () => { clearTimeout(t); resolve(); });
      });
    }

    if (ws.readyState === WebSocket.OPEN) {
      ffmpeg = spawn('ffmpeg', [
        '-f', 'pulse',
        '-i', 'v1.monitor',
        '-ar', '16000',
        '-ac', '1',
        '-f', 's16le',
        '-',
      ]);

      ffmpeg.stdout.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      ffmpeg.stderr.on('data', (d: Buffer) => {
        const line = d.toString().split('\n')[0];
        if (line) console.log('[ffmpeg-teams]', line);
      });

      console.log('[teams-bot] Audio capture started → audio processor');
    } else {
      console.warn('[teams-bot] Audio WS not open — skipping audio capture');
    }
  }

  // ─── Monitor for meeting end ───────────────────────────────────────────────
  const checkInterval = setInterval(async () => {
    try {
      const leaveVisible =
        await page.isVisible('[data-tid="hangup-button"]').catch(() => false) ||
        await page.isVisible('[aria-label="Leave"]').catch(() => false);

      if (!leaveVisible) {
        clearInterval(checkInterval);
        await sleep(3000);
        const stillIn = await page.isVisible('[data-tid="hangup-button"]').catch(() => false);
        if (!stillIn) await handleTeamsEnd(browser, ws, meetingId, ffmpeg);
      }
    } catch (_) {
      clearInterval(checkInterval);
      await handleTeamsEnd(browser, ws, meetingId, ffmpeg);
    }
  }, 10000);

  page.on('framenavigated', async (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (!url.includes('teams.microsoft.com') && !url.includes('teams.live.com') && url !== meetingUrl) {
      clearInterval(checkInterval);
      await handleTeamsEnd(browser, ws, meetingId, ffmpeg);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Guest bypass
// ─────────────────────────────────────────────────────────────────────────────

async function tryTeamsGuestBypass(page: import('playwright').Page, meetingUrl: string): Promise<boolean> {
  const guestLabels = [
    /continue without an account/i,
    /join as a guest/i,
    /continue as guest/i,
    /skip sign-in/i,
    /use without.*account/i,
    /sign in.*not required/i,
  ];

  for (const label of guestLabels) {
    try {
      const btn = page.getByRole('button', { name: label });
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click();
        await sleep(2000);
        if (!isSignInPage(page.url())) {
          console.log('[teams-bot] Guest bypass via button click');
          return true;
        }
      }
    } catch (_) {}
  }

  // Re-navigate directly
  try {
    await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);
    if (!isSignInPage(page.url())) {
      console.log('[teams-bot] Guest bypass via re-navigation');
      return true;
    }
  } catch (_) {}

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

async function handleTeamsEnd(
  browser: import('playwright').Browser,
  ws: WebSocket,
  meetingId: string,
  ffmpeg: ReturnType<typeof spawn> | null,
) {
  console.log(`[teams-bot] Meeting ${meetingId} ended — cleaning up`);
  if (ffmpeg) { try { ffmpeg.kill('SIGINT'); } catch (_) {} }
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
    ws.close();
  }
  try { await browser.close(); } catch (_) {}
  process.exit(0);
}
