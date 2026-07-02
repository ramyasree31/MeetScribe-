/**
 * meet-bot.ts — Signed-in mode (riteshmeetscribe@gmail.com)
 * Uses a persistent Chromium profile with cookies.json injected to bypass
 * Google's bot detection on CreateMeetingDevice.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { spawn, ChildProcess } from 'child_process';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { Kafka, Producer } from 'kafkajs';

import { MeetingState, MeetingStateMachine } from './state-machine';
import { FailureClassifier, JoinFailureReason, FAILURE_TO_STATE } from './failure-classifier';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  meetingUrl:        requiredEnv('MEETING_URL'),
  meetingId:         requiredEnv('MEETING_ID'),
  profileDir:        path.resolve(process.env.BOT_PROFILE_DIR ?? '/app/profiles/bot001-fresh'),
  audioProcessorUrl: process.env.AUDIO_PROCESSOR_URL ?? 'ws://audio-processor:8001',
  botName:           process.env.BOT_NAME ?? 'AI Notetaker',
  kafkaBrokers:      (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  // RC-7 fix: /app only exists in Docker. Fall back to CWD so local runs get screenshots.
  screenshotDir:     process.env.SCREENSHOT_DIR ?? (fs.existsSync('/app') ? '/app' : process.cwd()),

  /** How long to wait in the lobby for the host to admit the bot (ms). */
  admissionTimeoutMs: parseInt(process.env.ADMISSION_TIMEOUT_MS ?? '120000', 10),

  /** Max time to wait for Chrome to navigate to the meeting URL (ms). */
  navTimeoutMs: parseInt(process.env.NAV_TIMEOUT_MS ?? '60000', 10),

  /** Interval to poll for meeting-end signals (ms). */
  meetingCheckIntervalMs: parseInt(process.env.MEETING_CHECK_INTERVAL_MS ?? '3000', 10),

  /** Alone-for N checks before auto-leaving. Default 20 = 60 s at 3 s interval. */
  aloneCountThreshold: parseInt(process.env.ALONE_COUNT_THRESHOLD ?? '20', 10),
} as const;

function requiredEnv(key: string): string {
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
  info:  (...args: unknown[]) => console.log( '[meet-bot]',  ...args),
  warn:  (...args: unknown[]) => console.warn( '[meet-bot]', ...args),
  error: (...args: unknown[]) => console.error('[meet-bot]', ...args),
  diag:  (...args: unknown[]) => console.log( '[meet-bot/diag]', ...args),
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function saveScreenshot(page: Page, label: string): Promise<void> {
  try {
    const filepath = path.join(CONFIG.screenshotDir, `screenshot-${label}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    log.diag(`Screenshot saved: ${label}.png`);
  } catch (err) {
    log.warn(`Screenshot failed (${label}):`, (err as Error).message);
  }
}

async function saveDiagnostics(page: Page, label: string): Promise<void> {
  await saveScreenshot(page, label);
  try {
    const html = await page.content().catch(() => '');
    const filepath = path.join(CONFIG.screenshotDir, `dom-${label}.html`);
    fs.writeFileSync(filepath, html, 'utf8');
    log.diag(`DOM HTML saved: dom-${label}.html`);
  } catch {/* best-effort */}
}

// ─────────────────────────────────────────────────────────────────────────────
// Kafka
// ─────────────────────────────────────────────────────────────────────────────

let producer: Producer | null = null;

async function getKafkaProducer(): Promise<Producer | null> {
  if (producer) return producer;
  try {
    const kafka = new Kafka({
      clientId: `meet-bot-${CONFIG.meetingId}`,
      brokers: CONFIG.kafkaBrokers,
    });
    producer = kafka.producer();
    await producer.connect();
    log.info('Kafka producer connected');
    return producer;
  } catch (err) {
    log.warn('Kafka unavailable — state events will be skipped:', (err as Error).message);
    return null;
  }
}

async function emitKafkaEvent(
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const prod = await getKafkaProducer();
  if (!prod) return;
  try {
    await prod.send({
      topic,
      messages: [{ value: JSON.stringify({ ...payload, ts: new Date().toISOString() }) }],
    });
  } catch (err) {
    log.warn(`Kafka emit failed (topic=${topic}):`, (err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dismiss popups that block the lobby UI
// ─────────────────────────────────────────────────────────────────────────────

async function dismissPopups(page: Page): Promise<void> {
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
    } catch {/* ignore */}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Click "Join now" — single attempt, returns true/false
// ─────────────────────────────────────────────────────────────────────────────

async function fillNameFieldIfPresent(page: Page): Promise<void> {
  // Google Meet shows a "What's your name?" input in the guest/unauthenticated lobby.
  // The join button stays disabled until a name is entered. Fill it with BOT_NAME.
  const nameSelectors = [
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
    'input[data-testid*="name" i]',
  ];
  for (const sel of nameSelectors) {
    try {
      const input = page.locator(sel).first();
      if (!await input.isVisible({ timeout: 1000 })) continue;
      const current = await input.inputValue().catch(() => '');
      if (current.length > 0) {
        log.info(`Name field already filled: "${current}"`);
        return;
      }
      await input.fill(CONFIG.botName);
      await sleep(300);
      log.info(`Filled name field with: "${CONFIG.botName}"`);
      return;
    } catch { /* try next */ }
  }
}

async function clickJoinButton(page: Page): Promise<boolean> {
  // Fill the guest name field first — "Ask to join" stays disabled without it
  await fillNameFieldIfPresent(page);

  const labels = [
    /^join now$/i,
    /^join meeting$/i,
    /^ask to join$/i,
    /join now/i,
    /ask to join/i,
  ];

  log.diag(`URL when looking for join button: ${page.url()}`);

  for (const label of labels) {
    try {
      const btn = page.getByRole('button', { name: label }).first();
      if (!await btn.isVisible({ timeout: 2000 })) continue;

      // Wait up to 10s for the button to become enabled (mic/cam loading)
      for (let i = 0; i < 20; i++) {
        if (await btn.isEnabled().catch(() => false)) break;
        if (i % 4 === 0) await dismissPopups(page);
        await sleep(500);
      }

      if (!await btn.isEnabled().catch(() => false)) {
        log.warn(`Join button "${label}" found but stayed disabled after 10s`);
        continue;
      }

      const html = await btn.evaluate((el) => el.outerHTML).catch(() => '?');
      log.diag(`Join button HTML: ${html}`);
      await btn.hover().catch(() => {});
      await sleep(300);
      await btn.click();
      log.info(`Clicked join button: "${label}"`);
      await sleep(800);
      return true;
    } catch { /* try next label */ }
  }

  // CSS text fallback (handles translated UI or minor text changes)
  try {
    const btn = page.locator('button:has-text("Join"), button:has-text("Ask")').first();
    if (await btn.isVisible({ timeout: 2000 }) && await btn.isEnabled().catch(() => false)) {
      await btn.click();
      log.info('Clicked join button via CSS fallback');
      return true;
    }
  } catch { /* ignore */ }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry wrapper: attempt join up to maxAttempts times with re-dismiss between tries
// ─────────────────────────────────────────────────────────────────────────────

async function isAlreadyInCallOrWaitingRoom(page: Page): Promise<'in_call' | 'waiting_room' | 'none'> {
  const leaveVisible = await page.locator('[aria-label="Leave call"]').first()
    .isVisible({ timeout: 1500 }).catch(() => false);
  if (!leaveVisible) return 'none';

  // Leave call button is present — bot is either in waiting room or already admitted.
  // Distinguish by checking page text.
  const bodyText = await page.innerText('body').catch(() => '');
  if (
    bodyText.includes('You have joined the call') ||
    bodyText.includes("There's") ||
    bodyText.includes('other person') ||
    bodyText.includes('other people')
  ) {
    return 'in_call';
  }
  if (
    bodyText.includes('Please wait') ||
    bodyText.includes('bring you into the call') ||
    bodyText.includes('meeting host')
  ) {
    return 'waiting_room';
  }
  // Leave call visible but can't classify — assume waiting room to be safe
  return 'waiting_room';
}

async function clickJoinWithRetry(
  page: Page,
  maxAttempts = 3,
  retryDelayMs = 4000,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.info(`Join attempt ${attempt}/${maxAttempts} — URL: ${page.url()}`);
    await saveDiagnostics(page, `join-attempt-${attempt}`);

    // Check FIRST if bot is already inside or in waiting room.
    // This happens when: (1) join button was clicked on a previous attempt and
    // succeeded silently, (2) host auto-admitted the bot, (3) bot rejoined.
    // In all these cases the "Join now" button is gone — stop retrying.
    const callState = await isAlreadyInCallOrWaitingRoom(page);
    if (callState === 'in_call') {
      log.info(`Attempt ${attempt}: Bot already inside the call — skipping join click`);
      return true;
    }
    if (callState === 'waiting_room') {
      log.info(`Attempt ${attempt}: Bot in waiting room — handing off to admission wait`);
      return true;
    }

    // Dismiss any overlay dialogs that may be blocking the button
    for (let i = 0; i < 3; i++) {
      await dismissPopups(page);
      await sleep(400);
    }

    const clicked = await clickJoinButton(page);
    if (clicked) {
      await saveDiagnostics(page, `after-join-click-attempt-${attempt}`);
      return true;
    }

    const bodySnippet = (await page.innerText('body').catch(() => '')).substring(0, 600);
    log.warn(`Join button not found on attempt ${attempt} — waiting ${retryDelayMs}ms before retry`);
    log.diag(`Page text snapshot: ${bodySnippet.replace(/\n+/g, ' | ')}`);

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    }
  }

  const bodySnippet = (await page.innerText('body').catch(() => '')).substring(0, 800);
  log.error(`All ${maxAttempts} join attempts failed. Final page text: ${bodySnippet.replace(/\n+/g, ' | ')}`);
  await saveDiagnostics(page, 'join-all-attempts-failed');
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wait until admitted OR failure detected
// ─────────────────────────────────────────────────────────────────────────────

interface AdmissionResult {
  admitted: boolean;
  failureReason: JoinFailureReason | null;
}

async function waitUntilAdmitted(
  page: Page,
  classifier: FailureClassifier,
  timeoutMs = CONFIG.admissionTimeoutMs,
): Promise<AdmissionResult> {
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

async function getParticipantCount(page: Page): Promise<number> {
  const selectors = [
    '[data-tooltip*="people"]',
    '[aria-label*="people"]',
    '[data-tooltip*="Participants"]',
    '[aria-label*="Participants"]',
    '[data-tooltip*="Show everyone"]',
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (!await el.isVisible().catch(() => false)) continue;
    const text =
      await el.getAttribute('aria-label').catch(() => '') ||
      await el.getAttribute('data-tooltip').catch(() => '') ||
      await el.innerText().catch(() => '');
    const match = text.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }

  const tiles = await page.$$('[data-participant-id]');
  return tiles.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio capture via FFmpeg + PulseAudio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture audio from within the browser by intercepting WebRTC remote tracks.
 * Works on all platforms — no ffmpeg / PulseAudio / BlackHole needed.
 * Each incoming audio track from remote participants is connected to a Web Audio
 * ScriptProcessorNode that converts Float32 PCM → Int16 and sends it to Node.js
 * via exposeFunction, which forwards it to the audio-processor WebSocket.
 */
async function setupBrowserAudioCapture(
  context: BrowserContext,
  ws: WebSocket,
): Promise<void> {
  let chunkCount = 0;
  let nonSilentChunks = 0;
  await context.exposeFunction('__meetscribeAudioChunk', (base64: string, rmsDb: number) => {
    chunkCount++;
    const isSilent = rmsDb < -50;
    if (!isSilent) nonSilentChunks++;
    if (chunkCount === 1 || chunkCount % 50 === 0) {
      log.info(`[audio] chunk #${chunkCount} rms=${rmsDb.toFixed(1)}dB ${isSilent ? '(silence)' : '(SPEECH)'} nonSilent=${nonSilentChunks} ws=${ws.readyState}`);
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(Buffer.from(base64, 'base64'));
    }
  });

  await context.exposeFunction('__meetscribeInfo', (info: string) => {
    log.info(`[browser/diag] ${info}`);
  });

  // Receives actual AudioContext sample rate from browser — forwarded to audio-processor
  // so Deepgram is configured with the real rate (browser may ignore the 16000 hint)
  await context.exposeFunction('__meetscribeAudioConfig', (config: { sampleRate: number }) => {
    log.info(`[audio] Browser AudioContext actual sampleRate=${config.sampleRate}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'audio_config', sampleRate: config.sampleRate }));
    }
  });

  // Active speaker name reported from browser when the loudest track changes
  await context.exposeFunction('__meetscribeActiveSpeaker', (name: string) => {
    log.info(`[speaker] Active speaker: "${name}"`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'speaker_active', name }));
    }
  });

  // Participant roster reported from DOM scraping after joining
  await context.exposeFunction('__meetscribeParticipants', (names: string[]) => {
    log.info(`[speaker] Participants: ${names.join(', ')}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'participant_names', names }));
    }
  });

  await context.addInitScript(() => {
    const OrigRTC = window.RTCPeerConnection;
    let audioCtx: AudioContext | null = null;
    let processorInput: GainNode | null = null;
    let processor: any = null;

    // Per-track state for active speaker detection
    const trackAnalysers: Map<string, AnalyserNode> = new Map();
    const streamToName: Map<string, string> = new Map();
    let lastActiveSpeaker = '';
    let speakerPollTimer: ReturnType<typeof setInterval> | null = null;

    // DOM lookup: find participant name for a given MediaStream
    function lookupParticipantName(stream: MediaStream): string | null {
      // Try to find the video element that Google Meet attached this stream to
      const videos = Array.from(document.querySelectorAll('video'));
      for (const video of videos) {
        const src = (video as any).srcObject as MediaStream | null;
        if (!src) continue;
        // Match by stream id or by shared track id
        const matches = src.id === stream.id ||
          src.getTracks().some((t: MediaStreamTrack) =>
            stream.getTracks().some((s: MediaStreamTrack) => s.id === t.id));
        if (!matches) continue;

        // Walk up the DOM to find a participant tile with a name label
        const tile = video.closest('[data-participant-id]') || video.closest('[jsmodel]') || video.parentElement;
        if (!tile) continue;

        // Google Meet name label selectors (order of reliability)
        const nameSelectors = [
          '[data-display-name]',
          '[data-self-name]',
          '.zWGUib',
          '.NWpY0e',
          '[aria-label]',
          'span[dir="auto"]',
        ];
        for (const sel of nameSelectors) {
          const el = tile.querySelector(sel);
          if (!el) continue;
          const text = el.getAttribute('data-display-name')
            || el.getAttribute('data-self-name')
            || el.getAttribute('aria-label')
            || el.textContent?.trim();
          if (text && text.length > 0 && text.length < 60) return text;
        }
      }
      return null;
    }

    function startSpeakerPolling() {
      if (speakerPollTimer) return;
      speakerPollTimer = setInterval(() => {
        if (trackAnalysers.size === 0) return;

        let maxEnergy = 0;
        let loudestStreamId = '';
        const freqBuf = new Uint8Array(64);

        trackAnalysers.forEach((analyser, streamId) => {
          analyser.getByteFrequencyData(freqBuf);
          const energy = freqBuf.reduce((s, v) => s + v, 0) / freqBuf.length;
          if (energy > maxEnergy) { maxEnergy = energy; loudestStreamId = streamId; }
        });

        // Only fire when there's meaningful audio energy
        if (maxEnergy < 8 || !loudestStreamId) return;

        const name = streamToName.get(loudestStreamId);
        if (name && name !== lastActiveSpeaker) {
          lastActiveSpeaker = name;
          (window as any).__meetscribeActiveSpeaker(name);
        }
      }, 500);
    }

    function ensureAudioContext() {
      if (audioCtx && audioCtx.state !== 'closed') return;
      audioCtx = new AudioContext({ sampleRate: 16000 });
      processorInput = audioCtx.createGain();
      processor = (audioCtx as any).createScriptProcessor(4096, 1, 1);
      processorInput.connect(processor);
      processor.connect(audioCtx.destination);

      const actualRate = audioCtx.sampleRate;
      console.log(`[MeetScribe] AudioContext created, sampleRate: ${actualRate}`);
      (window as any).__meetscribeInfo(`AudioContext sampleRate=${actualRate}`);
      // Tell audio-processor the real sample rate so Deepgram is configured correctly
      (window as any).__meetscribeAudioConfig({ sampleRate: actualRate });

      processor.onaudioprocess = (ev: any) => {
        const data = (ev.inputBuffer as AudioBuffer).getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
        const rms = Math.sqrt(sumSq / data.length);
        const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
        const int16 = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
        }
        const bytes = new Uint8Array(int16.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        (window as any).__meetscribeAudioChunk(btoa(bin), rmsDb);
      };

      audioCtx.resume().catch(() => {});
    }

    (window as any).RTCPeerConnection = function (...args: any[]) {
      const pc = new OrigRTC(...args);
      console.log('[MeetScribe] RTCPeerConnection created');
      pc.addEventListener('track', (ev: RTCTrackEvent) => {
        const t = ev.track;
        console.log(`[MeetScribe] track event: ${t.kind} id=${t.id} muted=${t.muted}`);
        if (t.kind !== 'audio') return;
        ensureAudioContext();

        const stream = ev.streams[0] ?? new MediaStream([t]);
        const streamId = stream.id;

        try {
          // Main capture path: source → processorInput → ScriptProcessor → output
          const source = audioCtx!.createMediaStreamSource(new MediaStream([t]));
          source.connect(processorInput!);

          // Parallel path: source → analyser (for energy/speaker detection only)
          const analyser = audioCtx!.createAnalyser();
          analyser.fftSize = 128;
          source.connect(analyser);
          trackAnalysers.set(streamId, analyser);

          audioCtx!.resume().catch(() => {});
          console.log('[MeetScribe] Audio track connected');

          // Try to identify the participant name from DOM (retry after GM attaches stream to video)
          const tryLookup = (delay: number) => setTimeout(() => {
            if (!streamToName.has(streamId)) {
              const name = lookupParticipantName(stream);
              if (name) {
                streamToName.set(streamId, name);
                (window as any).__meetscribeInfo(`Stream ${streamId} → "${name}"`);
              }
            }
          }, delay);
          tryLookup(1500);
          tryLookup(4000);
          tryLookup(8000);

          startSpeakerPolling();
        } catch (e) {
          console.warn('[MeetScribe] Failed to connect audio track:', e);
        }
      });
      return pc;
    };
    Object.assign((window as any).RTCPeerConnection, OrigRTC);
    (window as any).RTCPeerConnection.prototype = OrigRTC.prototype;
    console.log('[MeetScribe] RTCPeerConnection interceptor installed');
  });

  log.info('Browser audio capture configured (in-browser WebRTC interception + speaker detection)');
}

// Read participant names from the Google Meet participants panel via Playwright DOM access.
// Called after the bot is admitted — runs in the live page context.
async function scrapeParticipantNames(page: Page): Promise<string[]> {
  try {
    // Try to open the participants panel
    const peopleBtn = page.locator('[aria-label*="people" i], [data-tooltip*="people" i], [aria-label*="participants" i]').first();
    if (await peopleBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await peopleBtn.click().catch(() => {});
      await sleep(1500);
    }

    const names = await page.evaluate((): string[] => {
      const found: string[] = [];
      const seen = new Set<string>();

      // Participants panel list items
      const panelSelectors = [
        '[data-participant-id] [data-display-name]',
        '[data-participant-id] [data-self-name]',
        '.cS7aqe',     // participant name in panel (historical)
        '.zWGUib',     // name label on tile
        '[jsname="YPqjbf"]', // name in participants list
      ];

      for (const sel of panelSelectors) {
        document.querySelectorAll(sel).forEach(el => {
          const name = el.getAttribute('data-display-name')
            || el.getAttribute('data-self-name')
            || el.textContent?.trim();
          if (name && name.length > 0 && name.length < 60 && !seen.has(name)) {
            seen.add(name);
            found.push(name);
          }
        });
      }
      return found;
    });

    log.info(`[speaker] DOM scrape found participants: ${names.join(', ') || '(none)'}`);
    return names;
  } catch (err) {
    log.warn('[speaker] Participant scrape failed:', (err as Error).message);
    return [];
  }
}

function startAudioCapture(ws: WebSocket): ChildProcess | null {
  if (ws.readyState !== WebSocket.OPEN) {
    log.warn('Audio WS not open — skipping audio capture');
    return null;
  }

  // On Linux (Docker) use PulseAudio monitor; on macOS use avfoundation virtual device.
  const isMac = process.platform === 'darwin';
  const ffmpegArgs = isMac
    ? [
        '-f', 'avfoundation',
        '-i', ':0',           // default system audio input (BlackHole or Built-in)
        '-ar', '16000',
        '-ac', '1',
        '-f', 's16le',
        '-',
      ]
    : [
        '-f', 'pulse',
        '-i', 'v1.monitor',
        '-ar', '16000',
        '-ac', '1',
        '-f', 's16le',
        '-',
      ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  ffmpeg.stdout!.on('data', (chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  ffmpeg.stderr!.on('data', (d: Buffer) => {
    const line = d.toString().split('\n')[0];
    if (line) log.diag('[ffmpeg]', line);
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

async function cleanup(
  context: BrowserContext,
  ws: WebSocket,
  ffmpeg: ChildProcess | null,
  meetingId: string,
): Promise<void> {
  log.info(`Cleaning up for meeting ${meetingId}`);

  if (ffmpeg) {
    try { ffmpeg.kill('SIGINT'); } catch {/* ignore */}
  }

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'meeting_ended', meetingId }));
    await sleep(500);
    ws.close();
  }

  try { await context.close(); } catch {/* ignore */}

  const prod = producer;
  if (prod) {
    try { await prod.disconnect(); } catch {/* ignore */}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log.info(`Starting for meeting ${CONFIG.meetingId} → ${CONFIG.meetingUrl}`);

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

  // ── Launch Chromium with persistent profile (signed-in as riteshmeetscribe@gmail.com) ──
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(CONFIG.profileDir, {
      headless: false,
      ignoreDefaultArgs: ['--enable-automation', '--disable-sync', '--disable-background-networking'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--autoplay-policy=no-user-gesture-required',
        '--window-size=1280,720',
      ],
      permissions: ['microphone', 'camera'],
      locale: 'en-US',
      viewport: { width: 1280, height: 720 },
    });
  } catch (err) {
    log.error('Failed to launch browser:', (err as Error).message);
    await emitKafkaEvent('bot.failed', {
      meetingId: CONFIG.meetingId,
      reason: JoinFailureReason.NETWORK_ERROR,
    });
    process.exit(1);
  }

  const classifier = new FailureClassifier();
  let ffmpeg: ChildProcess | null = null;
  let ended = false;

  const handleSignal = async () => {
    if (ended) return;
    ended = true;
    log.info('Received shutdown signal');
    await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
    process.exit(0);
  };
  process.once('SIGTERM', handleSignal);
  process.once('SIGINT', handleSignal);

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await setupBrowserAudioCapture(context, ws);

  // ── Inject cookies.json (cross-platform: macOS profile cookies won't decrypt on Linux) ──
  const cookiesPath = path.join(CONFIG.profileDir, 'cookies.json');
  if (fs.existsSync(cookiesPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      await context.addCookies(saved);
      log.info(`Injected ${saved.length} cookies from cookies.json`);
    } catch (err) {
      log.warn('Failed to inject cookies.json:', (err as Error).message);
    }
  } else {
    log.warn('No cookies.json — bot will join as guest (may be blocked by Google)');
  }

  // ── Navigate to meeting ───────────────────────────────────────────────────
  await fsm.transition(MeetingState.NAVIGATING);

  const page = await context.newPage();
  page.on('dialog', async (d) => d.accept().catch(() => {}));
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('[MeetScribe]')) log.info(`[browser] ${text}`);
  });
  classifier.attachToPage(page);

  log.info(`Navigating to meeting: ${CONFIG.meetingUrl}`);

  try {
    await page.goto(CONFIG.meetingUrl, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.navTimeoutMs,
    });
  } catch (err) {
    log.error('Navigation to meeting URL failed:', (err as Error).message);
    await saveDiagnostics(page, 'nav-failed');
    await fsm.transition(MeetingState.NETWORK_ERROR, { error: (err as Error).message });
    await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
    process.exit(1);
  }

  log.info(`Post-navigation URL: ${page.url()}`);
  await saveDiagnostics(page, 'post-navigation');

  // ── Pre-join lobby ────────────────────────────────────────────────────────
  await fsm.transition(MeetingState.LOBBY);

  // Wait for Meet's React bundle to render the lobby UI.
  // The join button is rendered by JavaScript — domcontentloaded fires before it exists.
  log.info('Waiting for Meet lobby to render…');
  await sleep(4000);

  const lobbyUrl = page.url();
  const lobbyTitle = await page.title().catch(() => '');
  log.info(`Lobby URL: ${lobbyUrl}`);
  log.info(`Lobby title: ${lobbyTitle}`);
  await saveDiagnostics(page, 'lobby-loaded');

  // Detect instant block (unauthenticated or domain-restricted) before trying to join
  if (!lobbyUrl.includes('meet.google.com')) {
    log.error(`Meet redirected away from meeting URL: ${lobbyUrl}`);
    await fsm.transition(MeetingState.FAILED, { reason: 'redirected_from_meet', url: lobbyUrl });
    await cleanup(context, ws, ffmpeg, CONFIG.meetingId);
    process.exit(1);
  }

  for (let i = 0; i < 3; i++) {
    await dismissPopups(page);
    await sleep(400);
  }

  // Dismiss microphone/camera permission dialogs if they appear
  try {
    const micDialog = page.getByRole('button', { name: /turn off microphone/i });
    if (await micDialog.isVisible({ timeout: 2000 })) {
      await micDialog.click();
      log.info('Dismissed microphone dialog');
    }
  } catch { /* ignore */ }

  // ── Click join (with retry) ───────────────────────────────────────────────
  await fsm.transition(MeetingState.WAITING_APPROVAL);
  classifier.markJoinClicked();

  const clicked = await clickJoinWithRetry(page, 3, 4000);
  if (!clicked) {
    log.error('Could not find or click join button after 3 attempts');
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

    process.exit(1);
  }

  // ── Inside the meeting ────────────────────────────────────────────────────
  await fsm.transition(MeetingState.JOINED);
  await emitKafkaEvent('meeting.joined', {
    meetingId: CONFIG.meetingId,
  });

  // Scrape participant names from DOM (non-blocking — runs after 3s to let the UI settle)
  sleep(3000).then(async () => {
    const names = await scrapeParticipantNames(page);
    if (names.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'participant_names', names }));
    }
    // Re-scrape after 15s to catch late joiners
    await sleep(15000);
    const names2 = await scrapeParticipantNames(page);
    if (names2.length > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: 'participant_names', names: names2 }));
    }
  }).catch(() => {});

  // ── Start audio capture ───────────────────────────────────────────────────
  // Wait for WS if still connecting
  if (!wsReady && ws.readyState === WebSocket.CONNECTING) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 6000);
      ws.once('open', () => { clearTimeout(t); resolve(); });
      ws.once('error', () => { clearTimeout(t); resolve(); });
    });
  }

  // Browser WebRTC interception captures real participant audio on all platforms.
  // ffmpeg/PulseAudio is disabled — it would send silence on Docker and corrupt
  // the audio stream by mixing two sources into the same WebSocket connection.
  log.info('Audio captured in-browser via WebRTC interception (all platforms)');
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
    if (ended) return;
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
      const leaveVisible =
        await page.isVisible('[aria-label="Leave call"]').catch(() => false) ||
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
      } else {
        aloneCount = 0;
      }
    } catch {
      if (!ended) {
        ended = true;
        clearInterval(checkInterval);
        await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
      }
    }
  }, CONFIG.meetingCheckIntervalMs);

  // Watch frame navigation (immediate detection)
  page.on('framenavigated', async (frame) => {
    if (ended || frame !== page.mainFrame()) return;
    if (!frame.url().includes('meet.google.com')) {
      ended = true;
      clearInterval(checkInterval);
      await handleMeetingEnd(fsm, context, ws, ffmpeg, CONFIG.meetingId);
    }
  });
}

async function handleMeetingEnd(
  fsm: MeetingStateMachine,
  context: BrowserContext,
  ws: WebSocket,
  ffmpeg: ChildProcess | null,
  meetingId: string,
): Promise<void> {
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
