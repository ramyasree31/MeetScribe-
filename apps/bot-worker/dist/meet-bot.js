"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const child_process_1 = require("child_process");
const ws_1 = __importDefault(require("ws"));
async function main() {
    const meetingUrl = process.env.MEETING_URL;
    const meetingId = process.env.MEETING_ID;
    const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001';
    if (!meetingUrl || !meetingId) {
        console.error('[meet-bot] Missing MEETING_URL or MEETING_ID');
        process.exit(1);
    }
    console.log(`[meet-bot] Starting for meeting ${meetingId} → ${meetingUrl}`);
    // ─── Non-blocking WebSocket connection ────────────────────────────────────
    // We connect to the audio processor but don't block the browser from
    // launching while waiting. If it fails, we still join — just without audio.
    const ws = new ws_1.default(`${audioProcessorUrl}/ws/${meetingId}`);
    let wsReady = false;
    ws.on('open', () => {
        wsReady = true;
        console.log('[meet-bot] Audio processor WebSocket connected');
    });
    ws.on('error', (err) => {
        console.warn('[meet-bot] Audio processor WS error (continuing without it):', err.message);
    });
    // ─── Launch Chromium ───────────────────────────────────────────────────────
    // headless: false is required for Xvfb (virtual display inside Docker).
    // True headless won't work with Google Meet's media permissions.
    const browser = await playwright_1.chromium.launch({
        headless: false,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--use-fake-ui-for-media-stream', // auto-grant mic/cam permissions
            '--use-fake-device-for-media-stream',
            '--disable-infobars',
            '--hide-scrollbars',
            '--window-size=1280,720',
            '--disable-blink-features=AutomationControlled',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        permissions: ['microphone', 'camera'],
        locale: 'en-US',
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });
    const page = await context.newPage();
    // Auto-dismiss any native dialogs
    page.on('dialog', async (dialog) => { await dialog.accept(); });
    console.log(`[meet-bot] Navigating to ${meetingUrl}`);
    try {
        await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    catch (err) {
        console.error('[meet-bot] Navigation failed:', err.message);
        try {
            await page.screenshot({ path: 'screenshot.png', fullPage: true });
            console.log('[meet-bot] Navigation error screenshot saved to screenshot.png');
        }
        catch (ssErr) {
            console.error('[meet-bot] Failed to save navigation error screenshot:', ssErr.message);
        }
        await browser.close();
        process.exit(1);
    }
    // Detect if redirected to Google Account sign-in (private meeting link restriction)
    if (page.url().includes('accounts.google.com') || page.url().includes('google.com/accounts')) {
        console.error('[meet-bot] Error: Private/restricted meeting link. Google Account login is required (guest access is disabled).');
        try {
            await page.screenshot({ path: 'screenshot.png', fullPage: true });
            console.log('[meet-bot] Saved screenshot of sign-in page to screenshot.png');
        }
        catch (_) { }
        await browser.close();
        process.exit(1);
    }
    // ─── Dismiss "Got it" / cookie banners ───────────────────────────────────
    try {
        const gotIt = page.getByText('Got it');
        if (await gotIt.isVisible({ timeout: 4000 }))
            await gotIt.click();
    }
    catch (_) { }
    // ─── Dismiss camera / mic pre-join screen ─────────────────────────────────
    // Google Meet sometimes shows a "Turn off microphone" dialog - dismiss it
    try {
        const turnOff = page.getByRole('button', { name: /turn off microphone/i });
        if (await turnOff.isVisible({ timeout: 3000 }))
            await turnOff.click();
    }
    catch (_) { }
    // ─── Enter name ───────────────────────────────────────────────────────────
    // First, check and dismiss any onboarding/sign-in popovers that might block click/fill actionability
    try {
        const gotItBtn = page.getByRole('button', { name: /got it|dismiss/i }).first();
        if (await gotItBtn.isVisible({ timeout: 5000 })) {
            await gotItBtn.click();
            console.log('[meet-bot] Dismissed onboarding popover ("Got it")');
        }
    }
    catch (_) { }
    // Wait for the name input (pre-join lobby)
    try {
        // In Google Meet, the name input is the only visible textbox on the lobby page.
        // getByRole('textbox') is the standard ARIA locator which is highly robust.
        const nameInput = page.getByRole('textbox').first();
        await nameInput.waitFor({ state: 'visible', timeout: 30000 });
        await nameInput.fill('AI Notetaker');
        console.log('[meet-bot] Filled name: AI Notetaker');
    }
    catch (err) {
        console.warn('[meet-bot] Name input not found — trying fallback selectors');
        try {
            const nameInputFallback = page.locator('input[type="text"], input[aria-label="Your name"], input[placeholder="Your name"]').first();
            await nameInputFallback.fill('AI Notetaker');
            console.log('[meet-bot] Filled name using fallback selector: AI Notetaker');
        }
        catch (fallbackErr) {
            console.warn('[meet-bot] Name input fallback failed:', fallbackErr.message);
        }
    }
    // ─── Click "Ask to join" or "Join now" ────────────────────────────────────
    try {
        // Exclude general "Join" (which matches tooltips like "Other ways to join") and use first() to avoid strict mode violations.
        const joinBtn = page.getByRole('button', { name: /Ask to join|Join now/i }).first();
        await joinBtn.waitFor({ state: 'visible', timeout: 15000 });
        await joinBtn.click();
        console.log('[meet-bot] Clicked join button');
    }
    catch (err) {
        console.error('[meet-bot] Could not find join button:', err.message);
        try {
            await page.screenshot({ path: 'screenshot.png', fullPage: true });
            console.log('[meet-bot] Debug screenshot saved to screenshot.png');
        }
        catch (ssErr) {
            console.error('[meet-bot] Failed to save screenshot:', ssErr.message);
        }
        await browser.close();
        process.exit(1);
    }
    // ─── Wait until we are inside the meeting ────────────────────────────────
    // Google Meet's "in-meeting" state is indicated by the bottom toolbar
    // (hangup button) or the participant tiles. We try multiple selectors.
    console.log('[meet-bot] Waiting to be admitted to meeting...');
    try {
        await Promise.race([
            // Hangup button = definitely inside the call
            page.waitForSelector('[data-tooltip="Leave call"]', { timeout: 120000 }),
            page.waitForSelector('[aria-label="Leave call"]', { timeout: 120000 }),
            // Participant grid
            page.waitForSelector('[jsname="HlFzId"]', { timeout: 120000 }),
            // Generic fallback — any element with data-participant-id
            page.waitForSelector('[data-participant-id]', { timeout: 120000 }),
        ]);
        console.log('[meet-bot] Joined the meeting ✅');
    }
    catch (err) {
        console.error('[meet-bot] Timed out waiting to join:', err.message);
        try {
            await page.screenshot({ path: 'screenshot-admit.png', fullPage: true });
            console.log('[meet-bot] Debug screenshot saved to screenshot-admit.png');
        }
        catch (ssErr) {
            console.error('[meet-bot] Failed to save screenshot:', ssErr.message);
        }
        await browser.close();
        process.exit(1);
    }
    // ─── Start audio capture ──────────────────────────────────────────────────
    // PulseAudio virtual sink is named "v1" (set up by entrypoint.sh).
    // We monitor the sink.monitor source to capture what's playing in the browser.
    let ffmpeg = null;
    if (wsReady || ws.readyState === ws_1.default.CONNECTING) {
        // Wait briefly for WS if still connecting
        if (ws.readyState === ws_1.default.CONNECTING) {
            await new Promise((resolve) => {
                const t = setTimeout(resolve, 5000);
                ws.once('open', () => { clearTimeout(t); resolve(); });
                ws.once('error', () => { clearTimeout(t); resolve(); });
            });
        }
        if (ws.readyState === ws_1.default.OPEN) {
            ffmpeg = (0, child_process_1.spawn)('ffmpeg', [
                '-f', 'pulse',
                '-i', 'v1.monitor', // capture the virtual sink monitor
                '-ar', '16000',
                '-ac', '1',
                '-f', 's16le',
                '-'
            ]);
            ffmpeg.stdout.on('data', (data) => {
                if (ws.readyState === ws_1.default.OPEN) {
                    ws.send(data);
                }
            });
            ffmpeg.stderr.on('data', (d) => {
                // Only log first few ffmpeg stderr lines to avoid log spam
                const line = d.toString().split('\n')[0];
                if (line)
                    console.log('[ffmpeg]', line);
            });
            console.log('[meet-bot] Audio capture started → audio processor');
        }
        else {
            console.warn('[meet-bot] Audio WS not open — skipping audio capture');
        }
    }
    // ─── Monitor for meeting end ───────────────────────────────────────────────
    const checkInterval = setInterval(async () => {
        try {
            // If navigated away from meet, or no participants visible, end
            const url = page.url();
            if (!url.includes('meet.google.com') && !url.includes(meetingUrl)) {
                clearInterval(checkInterval);
                await handleEnd(browser, ws, meetingId, ffmpeg);
                return;
            }
            // Check if we got kicked / meeting ended
            const hangupVisible = await page.isVisible('[data-tooltip="Leave call"]').catch(() => false)
                || await page.isVisible('[aria-label="Leave call"]').catch(() => false);
            if (!hangupVisible) {
                // Could be between page transitions — check once more after a delay
                clearInterval(checkInterval);
                await new Promise(r => setTimeout(r, 3000));
                const stillIn = await page.isVisible('[data-tooltip="Leave call"]').catch(() => false)
                    || await page.isVisible('[aria-label="Leave call"]').catch(() => false);
                if (!stillIn) {
                    await handleEnd(browser, ws, meetingId, ffmpeg);
                }
            }
        }
        catch (_) {
            clearInterval(checkInterval);
            await handleEnd(browser, ws, meetingId, ffmpeg);
        }
    }, 10000);
    // Handle page navigation (e.g. redirect after meeting ends)
    page.on('framenavigated', async (frame) => {
        if (frame !== page.mainFrame())
            return;
        const url = frame.url();
        if (!url.includes('meet.google.com') && url !== meetingUrl) {
            clearInterval(checkInterval);
            await handleEnd(browser, ws, meetingId, ffmpeg);
        }
    });
}
async function handleEnd(browser, ws, meetingId, ffmpeg) {
    console.log(`[meet-bot] Meeting ${meetingId} ended — cleaning up`);
    if (ffmpeg) {
        try {
            ffmpeg.kill('SIGINT');
        }
        catch (_) { }
    }
    if (ws.readyState === ws_1.default.OPEN) {
        ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
        ws.close();
    }
    try {
        await browser.close();
    }
    catch (_) { }
    process.exit(0);
}
main().catch((err) => {
    console.error('[meet-bot] Fatal error:', err);
    process.exit(1);
});
