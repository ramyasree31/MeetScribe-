import { chromium, BrowserContext, Page } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isSignInPage(url: string): boolean {
  return (
    url.includes('accounts.google.com') ||
    url.includes('google.com/accounts') ||
    url.includes('google.com/ServiceLogin') ||
    url.includes('signin/identifier')
  );
}

function isKickedPage(url: string): boolean {
  // Meet redirects to these URLs when a guest is rejected / kicked
  return (
    url.includes('meet.google.com/') &&
    (url.includes('?authuser') === false) &&
    !url.match(/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)
  );
}

async function saveScreenshot(page: Page, filename: string): Promise<void> {
  try {
    await page.screenshot({ path: `/app/${filename}`, fullPage: true });
    console.log(`[meet-bot] Screenshot saved: ${filename}`);
  } catch (err) {
    console.error(`[meet-bot] Failed to save screenshot "${filename}":`, (err as Error).message);
  }
}

async function getParticipantCount(page: Page): Promise<number> {
  try {
    // Try the participants panel button which shows a count
    const selectors = [
      '[data-tooltip*="Show everyone"]',
      '[aria-label*="Show everyone"]',
      '[data-tooltip*="people"]',
      '[aria-label*="people"]',
      '[data-tooltip*="Participants"]',
      '[aria-label*="Participants"]',
    ];

    for (const selector of selectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible().catch(() => false)) {
        const text =
          (await el.getAttribute('aria-label').catch(() => '')) ||
          (await el.getAttribute('data-tooltip').catch(() => '')) ||
          (await el.innerText().catch(() => ''));
        const match = text.match(/\d+/);
        if (match) {
          const val = parseInt(match[0], 10);
          if (!isNaN(val)) return val;
        }
      }
    }

    const participantElements = await page.$$('[data-participant-id]');
    if (participantElements.length > 0) return participantElements.length;
  } catch (_) {}
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dismiss popups / banners
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dismiss every Google popup that blocks the lobby UI.
 * Most importantly: the "Sign in with your Google account – Got it" tooltip
 * that appears on top of the name input and "Ask to join" button.
 */
async function dismissAllPopups(page: Page): Promise<void> {
  const clickables = [
    // The "Got it" in the "Sign in with Google – Got it" tooltip
    'button:has-text("Got it")',
    'span:has-text("Got it")',
    'div[role="button"]:has-text("Got it")',
    'div[role="button"]:has-text("got it" i)',
    'span:has-text("got it" i)',
    'button:has-text("got it" i)',
    '[aria-label="Got it"]',
    '[aria-label*="Got it" i]',
    // GDPR / cookie banners
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Dismiss")',
    'button:has-text("Close")',
  ];

  for (const selector of clickables) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        console.log(`[meet-bot] Dismissed popup: "${selector}"`);
        await sleep(400);
      }
    } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enter bot name
// ─────────────────────────────────────────────────────────────────────────────

async function enterBotName(page: Page, botName: string): Promise<void> {
  // Wait for the name input to be visible (up to 15 s)
  const nameInputSelectors = [
    'input[aria-label="Your name"]',
    'input[placeholder="Your name"]',
    'input[aria-label*="name" i]',
    'input[placeholder*="name" i]',
    'input[type="text"]',
  ];

  for (const selector of nameInputSelectors) {
    try {
      const input = page.locator(selector).first();
      if (await input.isVisible({ timeout: 5000 })) {
        await input.click({ clickCount: 3 }); // select all existing text
        await input.pressSequentially(botName, { delay: 120 });
        console.log(`[meet-bot] Filled name "${botName}" via: ${selector}`);
        return;
      }
    } catch (_) {}
  }

  // Also try role=textbox
  try {
    const input = page.getByRole('textbox').first();
    if (await input.isVisible({ timeout: 3000 })) {
      await input.click({ clickCount: 3 });
      await input.pressSequentially(botName, { delay: 120 });
      console.log(`[meet-bot] Filled name "${botName}" via role=textbox`);
      return;
    }
  } catch (_) {}

  console.warn('[meet-bot] Could not find name input — will join with existing/empty name');
}

// ─────────────────────────────────────────────────────────────────────────────
// Click Ask to Join / Join Now
// ─────────────────────────────────────────────────────────────────────────────

async function clickJoinButton(page: Page): Promise<boolean> {
  const labels = [
    /^ask to join$/i,
    /^join now$/i,
    /^join meeting$/i,
    /ask to join/i,
    /join now/i,
  ];

  for (const label of labels) {
    try {
      const btn = page.getByRole('button', { name: label }).first();
      if (await btn.isVisible({ timeout: 6000 })) {
        // Wait up to 5s for the button to be enabled (it is disabled if name isn't fully filled yet)
        let isEnabled = false;
        for (let i = 0; i < 10; i++) {
          if (await btn.isEnabled().catch(() => false)) {
            isEnabled = true;
            break;
          }
          await sleep(500);
        }
        if (isEnabled) {
          await btn.hover().catch(() => {});
          await sleep(800);
          await btn.click();
          console.log(`[meet-bot] Clicked join button: "${label instanceof RegExp ? label.source : label}"`);
          return true;
        } else {
          console.warn(`[meet-bot] Button "${label instanceof RegExp ? label.source : label}" found but remained disabled`);
        }
      }
    } catch (_) {}
  }

  // CSS fallback
  try {
    const btn = page.locator('button:has-text("Ask"), button:has-text("Join")').first();
    if (await btn.isVisible({ timeout: 4000 })) {
      let isEnabled = false;
      for (let i = 0; i < 8; i++) {
        if (await btn.isEnabled().catch(() => false)) {
          isEnabled = true;
          break;
        }
        await sleep(500);
      }
      if (isEnabled) {
        await btn.hover().catch(() => {});
        await sleep(800);
        await btn.click();
        console.log('[meet-bot] Clicked join button via CSS fallback');
        return true;
      }
    }
  } catch (_) {}

  const bodyText = await page.innerText('body').catch(() => '');
  console.log('[meet-bot] Page body text snippet:', bodyText.substring(0, 1000).replace(/\n+/g, ' | '));
  console.warn('[meet-bot] Could not find or click enabled join button');
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wait until actually inside the call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if we detected we are inside the meeting.
 * Returns false if kicked / timed out.
 */
async function waitUntilAdmitted(page: Page, timeoutMs = 90000): Promise<boolean> {
  console.log('[meet-bot] Waiting to be admitted (up to 90 s)...');

  // Selectors that only exist INSIDE a live call (never in lobby)
  const inCallSelectors = [
    '[aria-label="Leave call"]',
    '[data-tooltip="Leave call"]',
    'button[jsname="HlFzId"]',           // hangup button jsname
    '[data-participant-id]',              // another participant tile
  ];

  // Selectors that indicate we were rejected / kicked
  const rejectedTexts = [
    "You can't join this video call",
    'The video call ended because the connection was lost',
    'You have been removed from the meeting',
    'This call has ended',
  ];

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check rejection
    for (const text of rejectedTexts) {
      const visible = await page.locator(`text="${text}"`).isVisible().catch(() => false);
      if (visible) {
        console.log(`[meet-bot] Detected rejection: "${text}"`);
        return false;
      }
    }

    // Check in-call indicators
    for (const selector of inCallSelectors) {
      const visible = await page.locator(selector).first().isVisible().catch(() => false);
      if (visible) {
        console.log('[meet-bot] ✅ Detected in-call indicator:', selector);
        return true;
      }
    }

    await sleep(1000);
  }

  console.log('[meet-bot] Timed out waiting for admission');
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

async function handleEnd(
  browser: import('playwright').Browser,
  ws: WebSocket,
  meetingId: string,
  ffmpeg: ReturnType<typeof spawn> | null,
) {
  console.log(`[meet-bot] Meeting ${meetingId} ended — cleaning up`);

  if (ffmpeg) {
    try { ffmpeg.kill('SIGINT'); } catch (_) {}
  }

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
    await sleep(500);
    ws.close();
  }

  try { await browser.close(); } catch (_) {}
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const meetingUrl        = process.env.MEETING_URL;
  const meetingId         = process.env.MEETING_ID;
  const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001';
  const botName           = process.env.BOT_NAME || 'AI Notetaker';
  const MAX_KNOCK_RETRIES = 8;   // keep knocking every ~50 s for up to 8 tries

  if (!meetingUrl || !meetingId) {
    console.error('[meet-bot] Missing MEETING_URL or MEETING_ID');
    process.exit(1);
  }

  console.log(`[meet-bot] Starting for meeting ${meetingId} → ${meetingUrl}`);

  // ─── WebSocket to audio-processor ───────────────────────────────────────
  const ws = new WebSocket(`${audioProcessorUrl}/ws/${meetingId}`);
  let wsReady = false;

  ws.on('open', () => {
    wsReady = true;
    console.log('[meet-bot] Audio processor WebSocket connected');
  });
  ws.on('error', (err) => {
    console.warn('[meet-bot] Audio processor WS error (continuing):', err.message);
  });

  // ─── Launch Chrome ──────────────────────────────────────────────────────
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,                       // required for Xvfb inside Docker
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--use-fake-ui-for-media-stream',    // auto-grant mic/cam
      '--use-fake-device-for-media-stream',
      '--disable-infobars',
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  let admitted = false;
  let currentContext: BrowserContext | undefined;
  let page!: Page;

  for (let attempt = 1; attempt <= MAX_KNOCK_RETRIES; attempt++) {
    console.log(`[meet-bot] Knock attempt ${attempt}/${MAX_KNOCK_RETRIES}`);

    // Close previous page and context if they exist to start completely fresh
    if (page) {
      try { await page.close(); } catch (_) {}
    }
    if (currentContext) {
      try { await currentContext.close(); } catch (_) {}
    }

    currentContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua-platform-version': '"10.0.0"',
        'sec-ch-ua-arch': '"x86"',
        'sec-ch-ua-bitness': '"64"',
        'sec-ch-ua-model': '""',
      },
      permissions: ['microphone', 'camera'],
      locale: 'en-US',
      viewport: { width: 1280, height: 720 },
      screen: { width: 1920, height: 1080 }, // Emulate a screen size larger than viewport
      deviceScaleFactor: 1,
    });

    // Inject Google authentication cookies if provided
    const cookiesJson = process.env.GOOGLE_COOKIES_JSON;
    if (cookiesJson && cookiesJson.trim() !== '') {
      try {
        const cookies = JSON.parse(cookiesJson);
        if (Array.isArray(cookies)) {
          const formattedCookies = cookies.map((c: any) => {
            let sameSite = 'Lax';
            if (c.sameSite) {
              const s = c.sameSite.toLowerCase();
              if (s === 'no_restriction' || s === 'none') {
                sameSite = 'None';
              } else if (s === 'lax') {
                sameSite = 'Lax';
              } else if (s === 'strict') {
                sameSite = 'Strict';
              }
            }
            return {
              name: c.name,
              value: c.value,
              domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
              path: c.path || '/',
              secure: c.secure !== undefined ? c.secure : true,
              httpOnly: c.httpOnly !== undefined ? c.httpOnly : true,
              sameSite: sameSite as any,
            };
          });
          await currentContext.addCookies(formattedCookies);
          console.log('[meet-bot] Successfully injected Google cookies for signed-in session');
        }
      } catch (cookieErr: any) {
        console.error('[meet-bot] Failed to parse GOOGLE_COOKIES_JSON:', cookieErr.message);
      }
    }

    // Add init script to spoof platform and userAgentData to bypass Google Meet bot detection
    await currentContext.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
      });
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });

      // Spoof WebGL vendor and renderer (so Google Meet doesn't see a headless/virtualized GPU)
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel(R) Iris(TM) Plus Graphics 640';
        }
        return getParameter.apply(this, [parameter]);
      };

      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      if (getParameter2) {
        WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel(R) Iris(TM) Plus Graphics 640';
          }
          return getParameter2.apply(this, [parameter]);
        };
      }

      // Mock navigator.userAgentData
      const uaData = {
        brands: [
          { brand: 'Not/A)Brand', version: '8' },
          { brand: 'Chromium', version: '125' },
          { brand: 'Google Chrome', version: '125' },
        ],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: async (hints: string[]) => {
          const values: any = {
            brands: [
              { brand: 'Not/A)Brand', version: '8' },
              { brand: 'Chromium', version: '125' },
              { brand: 'Google Chrome', version: '125' },
            ],
            mobile: false,
            platform: 'Windows',
            platformVersion: '10.0.0',
            architecture: 'x86',
            model: '',
            bitness: '64',
            uaFullVersion: '125.0.0.0',
            fullVersionList: [
              { brand: 'Not/A)Brand', version: '8' },
              { brand: 'Chromium', version: '125' },
              { brand: 'Google Chrome', version: '125' },
            ],
          };
          const result: any = {};
          for (const hint of hints) {
            if (hint in values) {
              result[hint] = values[hint];
            }
          }
          return result;
        },
      };
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => uaData,
      });

      // Mock chrome object
      (window as any).chrome = {
        app: {
          isInstalled: false,
          InstallState: {
            DISABLED: 'disabled',
            INSTALLED: 'installed',
            NOT_INSTALLED: 'not_installed',
          },
          RunningState: {
            CANNOT_RUN: 'cannot_run',
            READY_TO_RUN: 'ready_to_run',
            RUNNING: 'running',
          },
        },
        runtime: {},
      };
    });

    page = await currentContext.newPage();
    page.on('dialog', async (dialog) => { await dialog.accept(); });

    // Navigate to meeting
    try {
      await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (err) {
      console.error('[meet-bot] Navigation failed:', (err as Error).message);
      await sleep(5000);
      continue;
    }

    console.log(`[meet-bot] Attempt ${attempt} — landed on: ${page.url()}`);

    // If Google redirected to sign-in, try to navigate back as guest
    if (isSignInPage(page.url())) {
      console.log('[meet-bot] Redirected to sign-in page — navigating back as guest');
      try {
        await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
      } catch (_) {}

      if (isSignInPage(page.url())) {
        console.error('[meet-bot] Still on sign-in after retry. Meeting may require a signed-in account. Exiting.');
        await saveScreenshot(page, 'screenshot-signin-blocked.png');
        await browser.close();
        process.exit(1);
      }
    }

    // Wait for lobby to be interactive
    await sleep(2500);

    // Dismiss "Sign in – Got it" tooltip and any other popups
    await dismissAllPopups(page);
    await sleep(500);

    // Dismiss any pre-join mic/camera dialogs
    try {
      const turnOff = page.getByRole('button', { name: /turn off microphone/i });
      if (await turnOff.isVisible({ timeout: 2000 })) {
        await turnOff.click();
        console.log('[meet-bot] Dismissed microphone dialog');
      }
    } catch (_) {}

    // Enter bot name
    await enterBotName(page, botName);
    await sleep(1500);

    // Dismiss popups again (they sometimes re-appear after interacting with the form)
    await dismissAllPopups(page);
    await sleep(1000);

    // Click Ask to join
    const clicked = await clickJoinButton(page);
    if (!clicked) {
      await saveScreenshot(page, `screenshot-no-join-btn-attempt${attempt}.png`);
      await sleep(3000);
      continue;
    }

    // Wait to be admitted (90 s window per attempt)
    admitted = await waitUntilAdmitted(page, 90000);

    if (admitted) {
      console.log(`[meet-bot] Admitted to meeting on attempt ${attempt} ✅`);
      break;
    }

    console.log(`[meet-bot] Not admitted on attempt ${attempt}. URL: ${page.url()} — waiting 20 s before re-knock...`);
    await saveScreenshot(page, `screenshot-knock-attempt${attempt}.png`);
    await sleep(20000);
  }

  if (!admitted) {
    console.error('[meet-bot] Exhausted all knock attempts. Giving up.');
    await saveScreenshot(page, 'screenshot-exhausted.png');
    await browser.close();
    // Still emit meeting_ended so audio-processor/summarizer clean up
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
      ws.close();
    }
    process.exit(1);
  }

  // ─── Start audio capture ─────────────────────────────────────────────────
  let ffmpeg: ReturnType<typeof spawn> | null = null;

  // Wait for WS if still connecting
  if (!wsReady && ws.readyState === WebSocket.CONNECTING) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 6000);
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

    ffmpeg.stdout!.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ffmpeg.stderr!.on('data', (d: Buffer) => {
      const line = d.toString().split('\n')[0];
      if (line) console.log('[ffmpeg]', line);
    });

    console.log('[meet-bot] Audio capture started → audio processor');
  } else {
    console.warn('[meet-bot] Audio WS not open — skipping audio capture');
  }

  // ─── Monitor meeting for end ─────────────────────────────────────────────
  let aloneCount = 0;
  let ended = false;

  const checkInterval = setInterval(async () => {
    if (ended) return;
    try {
      const url = page.url();

      // If redirected away from a meeting URL, the meeting ended
      if (!url.includes('meet.google.com')) {
        ended = true;
        clearInterval(checkInterval);
        await handleEnd(browser, ws, meetingId, ffmpeg);
        return;
      }

      // Check for "call ended" pages
      const callEndedTexts = [
        "You've left the meeting",
        'This call has ended',
        'You were removed from the meeting',
        'The video call ended',
      ];
      for (const text of callEndedTexts) {
        const visible = await page.locator(`text=${JSON.stringify(text)}`).isVisible().catch(() => false);
        if (visible) {
          console.log(`[meet-bot] Detected call end: "${text}"`);
          ended = true;
          clearInterval(checkInterval);
          await handleEnd(browser, ws, meetingId, ffmpeg);
          return;
        }
      }

      // Check leave button still present
      const leaveVisible =
        await page.isVisible('[aria-label="Leave call"]').catch(() => false) ||
        await page.isVisible('[data-tooltip="Leave call"]').catch(() => false);

      if (!leaveVisible) {
        console.log('[meet-bot] Leave button disappeared — meeting likely ended');
        ended = true;
        clearInterval(checkInterval);
        await sleep(3000);
        await handleEnd(browser, ws, meetingId, ffmpeg);
        return;
      }

      // Auto-leave when alone
      const count = await getParticipantCount(page);
      console.log(`[meet-bot] Participant count: ${count}`);
      if (count === 1) {
        aloneCount++;
        if (aloneCount >= 4) {    // alone for 12 s (4 * 3s)
          console.log('[meet-bot] Alone in meeting for 12 s — leaving');
          ended = true;
          clearInterval(checkInterval);
          await handleEnd(browser, ws, meetingId, ffmpeg);
        }
      } else {
        aloneCount = 0;
      }
    } catch (_) {
      ended = true;
      clearInterval(checkInterval);
      await handleEnd(browser, ws, meetingId, ffmpeg);
    }
  }, 3000);

  // Also watch page navigation events
  page.on('framenavigated', async (frame) => {
    if (ended || frame !== page.mainFrame()) return;
    const url = frame.url();
    if (!url.includes('meet.google.com')) {
      ended = true;
      clearInterval(checkInterval);
      await handleEnd(browser, ws, meetingId, ffmpeg);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[meet-bot] Fatal error:', err);
  process.exit(1);
});
