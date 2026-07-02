/**
 * meet-bot.ts  — Phase 1 (Authenticated Persistent Profile)
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE DECISION:
 *   Previous implementation used ephemeral browser.newContext() with injected
 *   cookies. This fails because Google Meet's server-side CreateMeetingDevice
 *   call validates identity tokens stored in a real Chromium profile, not just
 *   browser cookies in an ephemeral context.
 *
 *   This implementation uses chromium.launchPersistentContext() against a
 *   pre-authenticated profile directory. Each bot account has its own profile
 *   that is authenticated once manually (see scripts/authenticate-bot-profile.ts).
 *
 * REMOVED:
 *   ✗ browser.newContext() ephemeral contexts
 *   ✗ GOOGLE_COOKIES_JSON cookie injection
 *   ✗ navigator.webdriver spoofing
 *   ✗ WebGL vendor spoofing
 *   ✗ userAgentData spoofing
 *   ✗ User-Agent spoofing
 *   ✗ Guest retry loop (8 knock attempts)
 *
 * ADDED:
 *   ✓ chromium.launchPersistentContext() with real auth profile
 *   ✓ Pre-join session validation
 *   ✓ MeetingStateMachine FSM
 *   ✓ FailureClassifier — typed failure reasons
 *   ✓ Kafka events per state transition
 *   ✓ Structured logging
 *   ✓ Graceful cleanup with signal handlers
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { Kafka } from 'kafkajs';
import { MeetingState, MeetingStateMachine } from './state-machine';
import { FailureClassifier, JoinFailureReason, FAILURE_TO_STATE } from './failure-classifier';
import { validateBotSession, isSignInPage } from './profile-validator';
// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
    meetingUrl: requiredEnv('MEETING_URL'),
    meetingId: requiredEnv('MEETING_ID'),
    profileDir: path.resolve(process.env.BOT_PROFILE_DIR ?? '/app/profiles/bot001-fresh'),
    audioProcessorUrl: process.env.AUDIO_PROCESSOR_URL ?? 'ws://audio-processor:8001',
    botName: process.env.BOT_NAME ?? 'AI Notetaker',
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    screenshotDir: process.env.SCREENSHOT_DIR ?? '/app',
    /** How long to wait in the lobby for the host to admit the bot (ms). */
    admissionTimeoutMs: parseInt(process.env.ADMISSION_TIMEOUT_MS ?? '120000', 10),
    /** Max time to wait for Chrome to navigate to the meeting URL (ms). */
    navTimeoutMs: parseInt(process.env.NAV_TIMEOUT_MS ?? '60000', 10),
    /** Interval to poll for meeting-end signals (ms). */
    meetingCheckIntervalMs: parseInt(process.env.MEETING_CHECK_INTERVAL_MS ?? '3000', 10),
    /** Alone-for N checks before auto-leaving. */
    aloneCountThreshold: parseInt(process.env.ALONE_COUNT_THRESHOLD ?? '4', 10),
};
function requiredEnv(key) {
    const val = process.env[key];
    if (!val) {
        console.error(`[meet-bot] Missing required environment variable: ${key}`);
        process.exit(1);
    }
    return val;
}
// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────
const log = {
    info: (...args) => console.log('[meet-bot]', ...args),
    warn: (...args) => console.warn('[meet-bot]', ...args),
    error: (...args) => console.error('[meet-bot]', ...args),
    diag: (...args) => console.log('[meet-bot/diag]', ...args),
};
// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function saveScreenshot(page, label) {
    try {
        const filepath = path.join(CONFIG.screenshotDir, `screenshot-${label}.png`);
        await page.screenshot({ path: filepath, fullPage: true });
        log.diag(`Screenshot saved: ${label}.png`);
    }
    catch (err) {
        log.warn(`Screenshot failed (${label}):`, err.message);
    }
}
async function saveDiagnostics(page, label) {
    await saveScreenshot(page, label);
    try {
        const html = await page.content().catch(() => '');
        const filepath = path.join(CONFIG.screenshotDir, `dom-${label}.html`);
        fs.writeFileSync(filepath, html, 'utf8');
        log.diag(`DOM HTML saved: dom-${label}.html`);
    }
    catch { /* best-effort */ }
}
// ─────────────────────────────────────────────────────────────────────────────
// Kafka
// ─────────────────────────────────────────────────────────────────────────────
let producer = null;
async function getKafkaProducer() {
    if (producer)
        return producer;
    try {
        const kafka = new Kafka({
            clientId: `meet-bot-${CONFIG.meetingId}`,
            brokers: CONFIG.kafkaBrokers,
        });
        producer = kafka.producer();
        await producer.connect();
        log.info('Kafka producer connected');
        return producer;
    }
    catch (err) {
        log.warn('Kafka unavailable — state events will be skipped:', err.message);
        return null;
    }
}
async function emitKafkaEvent(topic, payload) {
    const prod = await getKafkaProducer();
    if (!prod)
        return;
    try {
        await prod.send({
            topic,
            messages: [{ value: JSON.stringify({ ...payload, ts: new Date().toISOString() }) }],
        });
    }
    catch (err) {
        log.warn(`Kafka emit failed (topic=${topic}):`, err.message);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Dismiss popups that block the lobby UI
// ─────────────────────────────────────────────────────────────────────────────
async function dismissPopups(page) {
    const selectors = [
        'button:has-text("Got it")',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Dismiss")',
        '[aria-label="Got it"]',
    ];
    for (const sel of selectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1000 })) {
                await btn.click();
                log.info(`Dismissed popup: "${sel}"`);
                await sleep(300);
            }
        }
        catch { /* ignore */ }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Click "Join now" (authenticated account — no name input needed)
// ─────────────────────────────────────────────────────────────────────────────
async function clickJoinButton(page) {
    // Authenticated users see "Join now" (not "Ask to join")
    const labels = [
        /^join now$/i,
        /^join meeting$/i,
        /^ask to join$/i,
        /join now/i,
        /ask to join/i,
    ];
    for (const label of labels) {
        try {
            const btn = page.getByRole('button', { name: label }).first();
            if (!await btn.isVisible({ timeout: 6000 }))
                continue;
            // Wait for button to be enabled (up to 10s)
            for (let i = 0; i < 20; i++) {
                if (await btn.isEnabled().catch(() => false))
                    break;
                if (i % 4 === 0)
                    await dismissPopups(page);
                await sleep(500);
            }
            if (!await btn.isEnabled().catch(() => false)) {
                log.warn(`Join button "${label}" found but stayed disabled`);
                continue;
            }
            const html = await btn.evaluate((el) => el.outerHTML).catch(() => '?');
            log.diag(`Join button HTML: ${html}`);
            await saveDiagnostics(page, 'before-join-click');
            await btn.hover().catch(() => { });
            await sleep(400);
            await btn.click();
            log.info(`Clicked join button: "${label}"`);
            await sleep(800);
            await saveDiagnostics(page, 'after-join-click');
            return true;
        }
        catch { /* try next label */ }
    }
    // CSS fallback
    try {
        const btn = page.locator('button:has-text("Join"), button:has-text("Ask")').first();
        if (await btn.isVisible({ timeout: 3000 }) && await btn.isEnabled().catch(() => false)) {
            await btn.click();
            log.info('Clicked join button via CSS fallback');
            return true;
        }
    }
    catch { /* ignore */ }
    const bodySnippet = (await page.innerText('body').catch(() => '')).substring(0, 500);
    log.warn(`No clickable join button found. Page text: ${bodySnippet.replace(/\n+/g, ' | ')}`);
    return false;
}
async function waitUntilAdmitted(page, classifier, timeoutMs = CONFIG.admissionTimeoutMs) {
    log.info(`Waiting for admission (up to ${timeoutMs / 1000}s)…`);
    const inCallSelectors = [
        '[aria-label="Leave call"]',
        '[data-tooltip="Leave call"]',
        'button[jsname="HlFzId"]', // hangup jsname
        '[data-participant-id]',
    ];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        // ── Check for failure ──────────────────────────────────────────────────
        const reason = await classifier.classify(page);
        if (reason !== null) {
            await saveDiagnostics(page, 'failure-state');
            log.error(`Join failure classified: ${reason} — ${FailureClassifier.describe(reason)}`);
            return { admitted: false, failureReason: reason };
        }
        // ── Check for success ──────────────────────────────────────────────────
        for (const sel of inCallSelectors) {
            if (await page.locator(sel).first().isVisible().catch(() => false)) {
                await saveDiagnostics(page, 'admitted-success');
                log.info(`✅ In-call indicator found: ${sel}`);
                return { admitted: true, failureReason: null };
            }
        }
        await sleep(1000);
    }
    log.warn('Admission timed out');
    await saveDiagnostics(page, 'admission-timeout');
    return { admitted: false, failureReason: JoinFailureReason.UNKNOWN };
}
// ─────────────────────────────────────────────────────────────────────────────
// Participant count (for alone-detection)
// ─────────────────────────────────────────────────────────────────────────────
async function getParticipantCount(page) {
    const selectors = [
        '[data-tooltip*="people"]',
        '[aria-label*="people"]',
        '[data-tooltip*="Participants"]',
        '[aria-label*="Participants"]',
        '[data-tooltip*="Show everyone"]',
    ];
    for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (!await el.isVisible().catch(() => false))
            continue;
        const text = await el.getAttribute('aria-label').catch(() => '') ||
            await el.getAttribute('data-tooltip').catch(() => '') ||
            await el.innerText().catch(() => '');
        const match = text.match(/\d+/);
        if (match)
            return parseInt(match[0], 10);
    }
    const tiles = await page.$$('[data-participant-id]');
    return tiles.length;
}
// ─────────────────────────────────────────────────────────────────────────────
// Audio capture via FFmpeg + PulseAudio
// ─────────────────────────────────────────────────────────────────────────────
function startAudioCapture(ws) {
    if (ws.readyState !== WebSocket.OPEN) {
        log.warn('Audio WS not open — skipping audio capture');
        return null;
    }
    const ffmpeg = spawn('ffmpeg', [
        '-f', 'pulse',
        '-i', 'v1.monitor',
        '-ar', '16000',
        '-ac', '1',
        '-f', 's16le',
        '-',
    ]);
    ffmpeg.stdout.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
        }
    });
    ffmpeg.stderr.on('data', (d) => {
        const line = d.toString().split('\n')[0];
        if (line)
            log.diag('[ffmpeg]', line);
    });
    ffmpeg.on('exit', (code) => {
        log.info(`FFmpeg exited (code=${code})`);
    });
    log.info('Audio capture started → audio-processor');
    return ffmpeg;
}
// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────
async function cleanup(context, ws, ffmpeg, meetingId) {
    log.info(`Cleaning up for meeting ${meetingId}`);
    if (ffmpeg) {
        try {
            ffmpeg.kill('SIGINT');
        }
        catch { /* ignore */ }
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
        await sleep(500);
        ws.close();
    }
    try {
        await context.close();
    }
    catch { /* ignore */ }
    const prod = producer;
    if (prod) {
        try {
            await prod.disconnect();
        }
        catch { /* ignore */ }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    log.info(`Starting for meeting ${CONFIG.meetingId} → ${CONFIG.meetingUrl}`);
    log.info(`Profile dir: ${CONFIG.profileDir}`);
    // ── Validate profile directory exists ────────────────────────────────────
    if (!fs.existsSync(CONFIG.profileDir)) {
        log.error(`Profile directory not found: ${CONFIG.profileDir}`);
        log.error('Run: npx ts-node scripts/authenticate-bot-profile.ts <profile-id>');
        process.exit(1);
    }
    // ── State machine setup ───────────────────────────────────────────────────
    const fsm = new MeetingStateMachine(CONFIG.meetingId, MeetingState.LAUNCHING);
    fsm.onTransition(async (from, to, meetingId, meta) => {
        // Emit Kafka event on every state transition
        await emitKafkaEvent('bot.state_changed', { meetingId, from, to, ...(meta ?? {}) });
    });
    // ── WebSocket to audio-processor ─────────────────────────────────────────
    const ws = new WebSocket(`${CONFIG.audioProcessorUrl}/ws/${CONFIG.meetingId}`);
    let wsReady = false;
    ws.on('open', () => {
        wsReady = true;
        log.info('Audio processor WebSocket connected');
    });
    ws.on('error', (err) => log.warn('Audio WS error (continuing):', err.message));
    // ── Launch Chrome with persistent profile ─────────────────────────────────
    let context;
    try {
        context = await chromium.launchPersistentContext(CONFIG.profileDir, {
            channel: 'chrome',
            headless: false, // Required — Xvfb handles display inside Docker
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--use-fake-ui-for-media-stream', // Auto-grant mic/cam permissions
                '--use-fake-device-for-media-stream',
                '--disable-infobars',
                '--window-size=1280,720',
                // NOTE: No navigator.webdriver spoofing — with a real authenticated
                // profile, Google's server-side checks pass without browser-level tricks.
            ],
            permissions: ['microphone', 'camera'],
            locale: 'en-US',
            viewport: { width: 1280, height: 720 },
        });
    }
    catch (err) {
        log.error('Failed to launch browser:', err.message);
        await emitKafkaEvent('bot.failed', {
            meetingId: CONFIG.meetingId,
            reason: JoinFailureReason.NETWORK_ERROR,
        });
        process.exit(1);
    }
    // Log all 4xx/5xx responses from Google
    const classifier = new FailureClassifier();
    let ffmpeg = null;
    let ended = false;
    // Graceful shutdown on SIGTERM (Docker stop)
    const handleSignal = async () => {
        if (ended)
            return;
        ended = true;
        log.info('Received shutdown signal');
        await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
        process.exit(0);
    };
    process.once('SIGTERM', handleSignal);
    process.once('SIGINT', handleSignal);
    // ── Session validation ────────────────────────────────────────────────────
    await fsm.transition(MeetingState.AUTHENTICATING);
    const page = await context.newPage();
    page.on('dialog', async (d) => d.accept().catch(() => { }));
    classifier.attachToPage(page);
    const session = await validateBotSession(context, page);
    if (!session.valid) {
        log.error('Bot session invalid — re-authentication required');
        log.error('Run: npx ts-node scripts/authenticate-bot-profile.ts <profile-id>');
        await saveDiagnostics(page, 'session-invalid');
        await fsm.transition(MeetingState.SESSION_EXPIRED, { profileDir: CONFIG.profileDir });
        await emitKafkaEvent('bot.session_expired', {
            meetingId: CONFIG.meetingId,
            profileDir: CONFIG.profileDir,
        });
        await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
        process.exit(2); // Exit code 2 = session expired (distinct from general failure)
    }
    log.info(`✅ Session valid — signed in as: ${session.email}`);
    // ── Navigate to meeting ───────────────────────────────────────────────────
    await fsm.transition(MeetingState.NAVIGATING);
    try {
        await page.goto(CONFIG.meetingUrl, {
            waitUntil: 'domcontentloaded',
            timeout: CONFIG.navTimeoutMs,
        });
    }
    catch (err) {
        log.error('Navigation failed:', err.message);
        await fsm.transition(MeetingState.NETWORK_ERROR, { error: err.message });
        await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
        process.exit(1);
    }
    log.info(`Landed on: ${page.url()}`);
    // Check if redirected to sign-in mid-flow (session expired between validation and join)
    if (isSignInPage(page.url())) {
        log.error('Redirected to sign-in after navigation — session expired mid-flight');
        await fsm.transition(MeetingState.SESSION_EXPIRED);
        await emitKafkaEvent('bot.session_expired', { meetingId: CONFIG.meetingId });
        await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
        process.exit(2);
    }
    // ── Pre-join lobby ────────────────────────────────────────────────────────
    await fsm.transition(MeetingState.LOBBY);
    // Dismiss any consent / popup dialogs
    await sleep(2000);
    for (let i = 0; i < 3; i++) {
        await dismissPopups(page);
        await sleep(500);
    }
    // Dismiss microphone/camera permission dialogs if they appear
    try {
        const micDialog = page.getByRole('button', { name: /turn off microphone/i });
        if (await micDialog.isVisible({ timeout: 2000 })) {
            await micDialog.click();
            log.info('Dismissed microphone dialog');
        }
    }
    catch { /* ignore */ }
    // ── Click join ────────────────────────────────────────────────────────────
    await fsm.transition(MeetingState.WAITING_APPROVAL);
    classifier.markJoinClicked();
    const clicked = await clickJoinButton(page);
    if (!clicked) {
        log.error('Could not find or click join button');
        await saveScreenshot(page, 'no-join-button');
        await fsm.transition(MeetingState.FAILED, { reason: 'join_button_not_found' });
        await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
        process.exit(1);
    }
    // ── Wait for admission ────────────────────────────────────────────────────
    const { admitted, failureReason } = await waitUntilAdmitted(page, classifier);
    if (!admitted) {
        const reason = failureReason ?? JoinFailureReason.UNKNOWN;
        const targetState = FAILURE_TO_STATE[reason];
        log.error(`Not admitted — ${reason}: ${FailureClassifier.describe(reason)}`);
        await fsm.tryTransition(targetState, { reason });
        await emitKafkaEvent('bot.join_failed', {
            meetingId: CONFIG.meetingId,
            reason,
            description: FailureClassifier.describe(reason),
        });
        await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
        // Exit code 3 = session-related, code 1 = general failure
        process.exit(failureReason === JoinFailureReason.SESSION_EXPIRED ? 2 : 1);
    }
    // ── Inside the meeting ────────────────────────────────────────────────────
    await fsm.transition(MeetingState.JOINED);
    await emitKafkaEvent('meeting.joined', {
        meetingId: CONFIG.meetingId,
        botEmail: session.email,
    });
    // ── Start audio capture ───────────────────────────────────────────────────
    // Wait for WS if still connecting
    if (!wsReady && ws.readyState === WebSocket.CONNECTING) {
        await new Promise((resolve) => {
            const t = setTimeout(resolve, 6000);
            ws.once('open', () => { clearTimeout(t); resolve(); });
            ws.once('error', () => { clearTimeout(t); resolve(); });
        });
    }
    ffmpeg = startAudioCapture(ws);
    await fsm.transition(MeetingState.RECORDING);
    // ── Monitor meeting for end ───────────────────────────────────────────────
    let aloneCount = 0;
    const callEndedTexts = [
        "You've left the meeting",
        'This call has ended',
        'You were removed from the meeting',
        'The video call ended',
    ];
    const checkInterval = setInterval(async () => {
        if (ended)
            return;
        try {
            const url = page.url();
            // Navigated away from Meet — call has ended
            if (!url.includes('meet.google.com')) {
                ended = true;
                clearInterval(checkInterval);
                await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
                return;
            }
            // Explicit "call ended" text
            for (const text of callEndedTexts) {
                if (await page.locator(`text=${JSON.stringify(text)}`).isVisible().catch(() => false)) {
                    log.info(`Call end detected: "${text}"`);
                    ended = true;
                    clearInterval(checkInterval);
                    await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
                    return;
                }
            }
            // Leave button disappeared
            const leaveVisible = await page.isVisible('[aria-label="Leave call"]').catch(() => false) ||
                await page.isVisible('[data-tooltip="Leave call"]').catch(() => false);
            if (!leaveVisible) {
                log.info('Leave button gone — meeting likely ended');
                ended = true;
                clearInterval(checkInterval);
                await sleep(3000);
                await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
                return;
            }
            // Alone-detection: auto-leave if only participant
            const count = await getParticipantCount(page);
            log.info(`Participant count: ${count}`);
            if (count === 1) {
                aloneCount++;
                if (aloneCount >= CONFIG.aloneCountThreshold) {
                    log.info(`Alone for ${CONFIG.aloneCountThreshold} checks — leaving`);
                    ended = true;
                    clearInterval(checkInterval);
                    await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
                }
            }
            else {
                aloneCount = 0;
            }
        }
        catch {
            if (!ended) {
                ended = true;
                clearInterval(checkInterval);
                await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
            }
        }
    }, CONFIG.meetingCheckIntervalMs);
    // Watch frame navigation (immediate detection)
    page.on('framenavigated', async (frame) => {
        if (ended || frame !== page.mainFrame())
            return;
        if (!frame.url().includes('meet.google.com')) {
            ended = true;
            clearInterval(checkInterval);
            await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
        }
    });
}
async function handleMeetingEnd(fsm, context, ws, ffmpeg, meetingId) {
    log.info(`Meeting ${meetingId} ended — cleaning up`);
    await fsm.tryTransition(MeetingState.PROCESSING);
    await emitKafkaEvent('meeting.ended', { meetingId });
    await cleanup(context, ws, ffmpeg, meetingId);
    process.exit(0);
}
// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
main().catch((err) => {
    log.error('Fatal error:', err);
    process.exit(1);
});
