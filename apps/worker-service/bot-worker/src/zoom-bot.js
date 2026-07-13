import { chromium } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isSignInPage(url) {
    return (url.includes('zoom.us/signin') ||
        url.includes('zoom.us/login') ||
        url.includes('/signin') ||
        url.includes('/login'));
}
async function saveScreenshot(page, filename) {
    try {
        await page.screenshot({ path: filename, fullPage: true });
        console.log(`[zoom-bot] Screenshot saved: ${filename}`);
    }
    catch (err) {
        console.error(`[zoom-bot] Failed to save screenshot "${filename}":`, err.message);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export async function runZoomBot() {
    const meetingUrl = process.env.MEETING_URL;
    const meetingId = process.env.MEETING_ID;
    const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001';
    const zoomPasscode = process.env.ZOOM_PASSCODE || '';
    const botName = process.env.BOT_NAME || 'AI Notetaker';
    if (!meetingUrl || !meetingId) {
        console.error('[zoom-bot] Missing MEETING_URL or MEETING_ID');
        process.exit(1);
    }
    console.log(`[zoom-bot] Starting for meeting ${meetingId} → ${meetingUrl}`);
    // ─── Non-blocking WebSocket connection ────────────────────────────────────
    const ws = new WebSocket(`${audioProcessorUrl}/ws/${meetingId}`);
    let wsReady = false;
    ws.on('open', () => {
        wsReady = true;
        console.log('[zoom-bot] Audio processor WebSocket connected');
    });
    ws.on('error', (err) => {
        console.warn('[zoom-bot] Audio processor WS error (continuing without it):', err.message);
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
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        permissions: ['microphone', 'camera'],
        locale: 'en-US',
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const page = await context.newPage();
    page.on('dialog', async (dialog) => { await dialog.accept(); });
    // ─── Build the web-client URL ─────────────────────────────────────────────
    // Zoom standard links:  zoom.us/j/<id>?pwd=<pwd>
    // Web client links:     zoom.us/wc/join/<id>
    let webClientUrl = meetingUrl;
    if (meetingUrl.includes('/j/')) {
        webClientUrl = meetingUrl.replace('/j/', '/wc/join/');
    }
    else if (!meetingUrl.includes('/wc/')) {
        // If it's just a numeric ID, build from scratch
        const match = meetingUrl.match(/(\d{9,11})/);
        if (match) {
            webClientUrl = `https://zoom.us/wc/join/${match[1]}`;
        }
    }
    console.log(`[zoom-bot] Navigating to Zoom web client: ${webClientUrl}`);
    try {
        await page.goto(webClientUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    catch (err) {
        console.error('[zoom-bot] Navigation failed:', err.message);
        await saveScreenshot(page, 'screenshot-zoom-nav-error.png');
        await browser.close();
        process.exit(1);
    }
    await sleep(2000);
    // ─── Detect sign-in wall ───────────────────────────────────────────────────
    if (isSignInPage(page.url())) {
        console.error('[zoom-bot] Redirected to Zoom sign-in. ' +
            'This meeting requires authentication or the web client is disabled by the host.');
        await saveScreenshot(page, 'screenshot-zoom-signin.png');
        await browser.close();
        process.exit(1);
    }
    // ─── Dismiss cookie/consent banners ───────────────────────────────────────
    for (const label of [/accept.*cookies/i, /agree/i, /got it/i]) {
        try {
            const btn = page.getByRole('button', { name: label });
            if (await btn.isVisible({ timeout: 2000 })) {
                await btn.click();
                await sleep(500);
            }
        }
        catch (_) { }
    }
    // ─── Fill name ────────────────────────────────────────────────────────────
    const nameSelectors = [
        'input[placeholder="Your Name"]',
        'input[placeholder*="name" i]',
        'input[aria-label*="name" i]',
        'input[id*="inputname" i]',
    ];
    let nameFilled = false;
    for (const selector of nameSelectors) {
        try {
            const input = page.locator(selector).first();
            await input.waitFor({ state: 'visible', timeout: selector === nameSelectors[0] ? 25000 : 3000 });
            await input.clear();
            await input.fill(botName);
            console.log(`[zoom-bot] Filled name: ${botName}`);
            nameFilled = true;
            break;
        }
        catch (_) { }
    }
    if (!nameFilled) {
        console.warn('[zoom-bot] Could not find name input — proceeding without filling name');
    }
    // ─── Fill passcode if required ────────────────────────────────────────────
    if (zoomPasscode) {
        const passcodeSelectors = [
            'input[placeholder="Meeting Passcode"]',
            'input[placeholder*="passcode" i]',
            'input[aria-label*="passcode" i]',
        ];
        for (const selector of passcodeSelectors) {
            try {
                const input = page.locator(selector).first();
                if (await input.isVisible({ timeout: 3000 })) {
                    await input.fill(zoomPasscode);
                    console.log('[zoom-bot] Filled meeting passcode');
                    break;
                }
            }
            catch (_) { }
        }
    }
    // ─── Click Join ───────────────────────────────────────────────────────────
    const joinSelectors = [
        { role: 'button', name: /^join$/i },
        { role: 'button', name: /join meeting/i },
        { role: 'button', name: /join now/i },
    ];
    let joined = false;
    for (const sel of joinSelectors) {
        try {
            const btn = page.getByRole(sel.role, { name: sel.name }).first();
            if (await btn.isVisible({ timeout: 5000 })) {
                await btn.click();
                console.log(`[zoom-bot] Clicked join button`);
                joined = true;
                break;
            }
        }
        catch (_) { }
    }
    if (!joined) {
        // CSS fallback
        try {
            const fallback = page.locator('button.join-btn, button[class*="join"]').first();
            if (await fallback.isVisible({ timeout: 3000 })) {
                await fallback.click();
                joined = true;
            }
        }
        catch (_) { }
    }
    if (!joined) {
        console.error('[zoom-bot] Could not find join button');
        await saveScreenshot(page, 'screenshot-zoom-no-join.png');
        await browser.close();
        process.exit(1);
    }
    // ─── Wait for meeting controls (admitted) ─────────────────────────────────
    console.log('[zoom-bot] Waiting to be admitted to meeting...');
    try {
        await Promise.race([
            page.waitForSelector('button[aria-label^="Leave"]', { timeout: 180000 }),
            page.waitForSelector('button[aria-label^="Mute"]', { timeout: 180000 }),
            page.waitForSelector('.footer-button__button', { timeout: 180000 }),
        ]);
        console.log('[zoom-bot] Joined the Zoom meeting ✅');
    }
    catch (err) {
        console.error('[zoom-bot] Timed out waiting to join:', err.message);
        await saveScreenshot(page, 'screenshot-zoom-admit.png');
        await browser.close();
        process.exit(1);
    }
    // ─── Click "Join Audio by Computer" if prompted ────────────────────────────
    try {
        const joinAudioBtn = page.getByRole('button', { name: /join audio by computer/i });
        if (await joinAudioBtn.isVisible({ timeout: 8000 })) {
            await joinAudioBtn.click();
            console.log('[zoom-bot] Clicked "Join Audio by Computer"');
        }
    }
    catch (_) { }
    // ─── Start audio capture ───────────────────────────────────────────────────
    let ffmpeg = null;
    if (wsReady || ws.readyState === WebSocket.CONNECTING) {
        if (ws.readyState === WebSocket.CONNECTING) {
            await new Promise((resolve) => {
                const t = setTimeout(resolve, 5000);
                ws.once('open', () => { clearTimeout(t); resolve(); });
                ws.once('error', () => { clearTimeout(t); resolve(); });
            });
        }
        if (ws.readyState === WebSocket.OPEN) {
            ffmpeg = spawn('ffmpeg', [
                '-f', 'pulse',
                '-i', 'v1.monitor', // virtual sink monitor (same as meet-bot)
                '-ar', '16000',
                '-ac', '1',
                '-f', 's16le',
                '-',
            ]);
            ffmpeg.stdout.on('data', (data) => {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(data);
            });
            ffmpeg.stderr.on('data', (d) => {
                const line = d.toString().split('\n')[0];
                if (line)
                    console.log('[ffmpeg-zoom]', line);
            });
            console.log('[zoom-bot] Audio capture started → audio processor');
        }
        else {
            console.warn('[zoom-bot] Audio WS not open — skipping audio capture');
        }
    }
    // ─── Monitor for meeting end ───────────────────────────────────────────────
    page.on('framenavigated', async (frame) => {
        if (frame !== page.mainFrame())
            return;
        const url = frame.url();
        if (url.includes('postattendee') || (!url.includes('zoom.us') && url !== meetingUrl)) {
            await handleZoomEnd(browser, ws, meetingId, ffmpeg);
        }
    });
    const checkInterval = setInterval(async () => {
        try {
            const leaveCount = await page.locator('button[aria-label^="Leave"]').count();
            const muteCount = await page.locator('button[aria-label^="Mute"]').count();
            if (leaveCount === 0 && muteCount === 0) {
                clearInterval(checkInterval);
                await new Promise((r) => setTimeout(r, 3000));
                const stillIn = await page.locator('button[aria-label^="Leave"]').count() > 0;
                if (!stillIn)
                    await handleZoomEnd(browser, ws, meetingId, ffmpeg);
            }
        }
        catch (_) {
            clearInterval(checkInterval);
            await handleZoomEnd(browser, ws, meetingId, ffmpeg);
        }
    }, 10000);
}
// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────
async function handleZoomEnd(browser, ws, meetingId, ffmpeg) {
    console.log(`[zoom-bot] Meeting ${meetingId} ended — cleaning up`);
    if (ffmpeg) {
        try {
            ffmpeg.kill('SIGINT');
        }
        catch (_) { }
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
        ws.close();
    }
    try {
        await browser.close();
    }
    catch (_) { }
    process.exit(0);
}
