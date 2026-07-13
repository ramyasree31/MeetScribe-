import { chromium } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isSignInPage(url) {
    return (url.includes('idbroker.webex.com') ||
        url.includes('signin.webex.com') ||
        url.includes('login.webex.com') ||
        url.includes('/signin') ||
        url.includes('/login'));
}
async function saveScreenshot(page, filename) {
    try {
        await page.screenshot({ path: filename, fullPage: true });
        console.log(`[webex-bot] Screenshot saved: ${filename}`);
    }
    catch (err) {
        console.error(`[webex-bot] Failed to save screenshot "${filename}":`, err.message);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export async function runWebexBot() {
    const meetingUrl = process.env.MEETING_URL;
    const meetingId = process.env.MEETING_ID;
    const audioProcessorUrl = process.env.AUDIO_PROCESSOR_URL || 'ws://audio-processor:8001';
    const botName = process.env.BOT_NAME || 'AI Notetaker';
    if (!meetingUrl || !meetingId) {
        console.error('[webex-bot] Missing MEETING_URL or MEETING_ID');
        process.exit(1);
    }
    console.log(`[webex-bot] Starting for meeting ${meetingId} → ${meetingUrl}`);
    // ─── Non-blocking WebSocket connection ────────────────────────────────────
    const ws = new WebSocket(`${audioProcessorUrl}/ws/${meetingId}`);
    let wsReady = false;
    ws.on('open', () => {
        wsReady = true;
        console.log('[webex-bot] Audio processor WebSocket connected');
    });
    ws.on('error', (err) => {
        console.warn('[webex-bot] Audio processor WS error (continuing without it):', err.message);
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
    // ─── Navigate to Webex meeting ─────────────────────────────────────────────
    // Webex meeting links look like:
    //   https://company.webex.com/meet/<id>
    //   https://webex.com/meet/<id>
    //   https://company.webex.com/company/j.php?MTID=...
    console.log(`[webex-bot] Navigating to: ${meetingUrl}`);
    try {
        await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    catch (err) {
        console.error('[webex-bot] Navigation failed:', err.message);
        await saveScreenshot(page, 'screenshot-webex-nav-error.png');
        await browser.close();
        process.exit(1);
    }
    await sleep(3000);
    // ─── Handle sign-in redirect — attempt guest bypass ───────────────────────
    if (isSignInPage(page.url())) {
        console.log('[webex-bot] Redirected to Webex sign-in — attempting guest bypass...');
        const bypassed = await tryWebexGuestBypass(page, meetingUrl);
        if (!bypassed) {
            console.error('[webex-bot] Could not bypass Webex sign-in.');
            await saveScreenshot(page, 'screenshot-webex-signin.png');
            await browser.close();
            process.exit(1);
        }
        await sleep(3000);
    }
    // ─── Click "Join from Browser" to skip the Webex app download prompt ──────
    const browserJoinLabels = [
        /join from.*browser/i,
        /join in.*browser/i,
        /use.*browser/i,
        /continue in browser/i,
        /join without app/i,
    ];
    for (const label of browserJoinLabels) {
        try {
            const btn = page.getByRole('button', { name: label });
            const lnk = page.getByRole('link', { name: label });
            if (await btn.isVisible({ timeout: 5000 })) {
                await btn.click();
                console.log('[webex-bot] Clicked "Join from browser"');
                await sleep(2000);
                break;
            }
            else if (await lnk.isVisible({ timeout: 2000 })) {
                await lnk.click();
                console.log('[webex-bot] Clicked "Join from browser" link');
                await sleep(2000);
                break;
            }
        }
        catch (_) { }
    }
    // ─── Dismiss cookie/GDPR banners ──────────────────────────────────────────
    for (const label of [/accept all/i, /accept/i, /agree/i, /got it/i]) {
        try {
            const btn = page.getByRole('button', { name: label }).first();
            if (await btn.isVisible({ timeout: 2000 })) {
                await btn.click();
                await sleep(400);
            }
        }
        catch (_) { }
    }
    // ─── Fill name ────────────────────────────────────────────────────────────
    const nameSelectors = [
        'input[placeholder*="name" i]',
        'input[aria-label*="name" i]',
        'input[name="name"]',
        'input[id*="name" i]',
        '#guest-name',
    ];
    let nameFilled = false;
    for (const selector of nameSelectors) {
        try {
            const input = page.locator(selector).first();
            const timeout = selector === nameSelectors[0] ? 25000 : 3000;
            await input.waitFor({ state: 'visible', timeout });
            await input.clear();
            await input.fill(botName);
            console.log(`[webex-bot] Filled name: ${botName}`);
            nameFilled = true;
            break;
        }
        catch (_) { }
    }
    if (!nameFilled) {
        console.warn('[webex-bot] Could not find name input — proceeding without filling name');
    }
    // ─── Fill email if required ────────────────────────────────────────────────
    try {
        const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first();
        if (await emailInput.isVisible({ timeout: 3000 })) {
            await emailInput.fill('bot@meetscribe.ai');
            console.log('[webex-bot] Filled email: bot@meetscribe.ai');
        }
    }
    catch (_) { }
    // ─── Click Join ───────────────────────────────────────────────────────────
    const joinLabels = [/^join$/i, /join meeting/i, /join now/i, /join.*guest/i];
    let joined = false;
    for (const label of joinLabels) {
        try {
            const btn = page.getByRole('button', { name: label }).first();
            if (await btn.isVisible({ timeout: 8000 })) {
                await btn.click();
                console.log('[webex-bot] Clicked join button');
                joined = true;
                break;
            }
        }
        catch (_) { }
    }
    if (!joined) {
        console.error('[webex-bot] Could not find join button');
        await saveScreenshot(page, 'screenshot-webex-no-join.png');
        await browser.close();
        process.exit(1);
    }
    // ─── Wait to be admitted ───────────────────────────────────────────────────
    console.log('[webex-bot] Waiting to be admitted to Webex meeting...');
    try {
        await Promise.race([
            page.waitForSelector('[aria-label*="leave" i]', { timeout: 180000 }),
            page.waitForSelector('[data-cy="leave-btn"]', { timeout: 180000 }),
            page.waitForSelector('.leave-button', { timeout: 180000 }),
            page.waitForSelector('[aria-label*="mute" i]', { timeout: 180000 }),
        ]);
        console.log('[webex-bot] Joined the Webex meeting ✅');
    }
    catch (err) {
        console.error('[webex-bot] Timed out waiting to join:', err.message);
        await saveScreenshot(page, 'screenshot-webex-admit.png');
        await browser.close();
        process.exit(1);
    }
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
                '-i', 'v1.monitor',
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
                    console.log('[ffmpeg-webex]', line);
            });
            console.log('[webex-bot] Audio capture started → audio processor');
        }
        else {
            console.warn('[webex-bot] Audio WS not open — skipping audio capture');
        }
    }
    // ─── Monitor for meeting end ───────────────────────────────────────────────
    const checkInterval = setInterval(async () => {
        try {
            const leaveVisible = await page.isVisible('[aria-label*="leave" i]').catch(() => false) ||
                await page.isVisible('[data-cy="leave-btn"]').catch(() => false);
            if (!leaveVisible) {
                clearInterval(checkInterval);
                await sleep(3000);
                const stillIn = await page.isVisible('[aria-label*="leave" i]').catch(() => false);
                if (!stillIn)
                    await handleWebexEnd(browser, ws, meetingId, ffmpeg);
            }
        }
        catch (_) {
            clearInterval(checkInterval);
            await handleWebexEnd(browser, ws, meetingId, ffmpeg);
        }
    }, 10000);
    page.on('framenavigated', async (frame) => {
        if (frame !== page.mainFrame())
            return;
        const url = frame.url();
        if (!url.includes('webex.com') && url !== meetingUrl) {
            clearInterval(checkInterval);
            await handleWebexEnd(browser, ws, meetingId, ffmpeg);
        }
    });
}
// ─────────────────────────────────────────────────────────────────────────────
// Guest bypass
// ─────────────────────────────────────────────────────────────────────────────
async function tryWebexGuestBypass(page, meetingUrl) {
    const guestLabels = [
        /continue as guest/i,
        /join as guest/i,
        /continue without signing in/i,
        /skip/i,
    ];
    for (const label of guestLabels) {
        try {
            const btn = page.getByRole('button', { name: label });
            if (await btn.isVisible({ timeout: 3000 })) {
                await btn.click();
                await sleep(2000);
                if (!isSignInPage(page.url()))
                    return true;
            }
        }
        catch (_) { }
    }
    // Re-navigate
    try {
        await page.goto(meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
        if (!isSignInPage(page.url()))
            return true;
    }
    catch (_) { }
    return false;
}
// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────
async function handleWebexEnd(browser, ws, meetingId, ffmpeg) {
    console.log(`[webex-bot] Meeting ${meetingId} ended — cleaning up`);
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
