/**
 * refresh-session-mac.cjs
 *
 * macOS-native session keeper — runs on the Mac host, NOT in Docker.
 * Keeps riteshmeetscribe@gmail.com signed in automatically.
 *
 * HOW IT WORKS (same technique as Otter.ai / Fireflies.ai):
 *   1. First run (--setup): Opens Chrome visibly, you sign in once → profile saved.
 *   2. Every 10 hours: Headless Chrome reuses the saved profile, refreshes
 *      Google session tokens, exports fresh cookies.json to the Docker volume.
 *   3. Every bot run picks up the fresh cookies automatically.
 *
 * USAGE:
 *   First time:   node scripts/refresh-session-mac.cjs --setup
 *   Keep running: node scripts/refresh-session-mac.cjs
 *   With pm2:     pm2 start scripts/refresh-session-mac.cjs --name meetscribe-session
 */

'use strict';

const { chromium } = require('playwright');
const fs            = require('fs');
const path          = require('path');
const readline      = require('readline');
const { execSync }  = require('child_process');

// ── Paths ────────────────────────────────────────────────────────────────────

// Persistent Chrome profile on macOS (survives reboots, code updates, etc.)
// Stored outside the project so it's never accidentally deleted or committed.
const MAC_PROFILE  = path.join(
  process.env.HOME,
  '.meetscribe',
  'session-profile',
  'bot001',
);

// Output path — this is the Docker-mounted volume the bot reads at startup.
const COOKIES_OUT  = path.join(__dirname, '..', 'profiles', 'bot001-fresh', 'cookies.json');

// Also write to bot001 so the session-keeper in Docker (if re-enabled) works too.
const COOKIES_OUT2 = path.join(__dirname, '..', 'profiles', 'bot001', 'cookies.json');

const INTERVAL_HOURS = parseInt(process.env.REFRESH_INTERVAL_HOURS || '10', 10);
const SETUP_MODE     = process.argv.includes('--setup');

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[session-keeper] ${new Date().toISOString()} — ${msg}`); }
function warn(msg) { console.warn(`[session-keeper] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[session-keeper] ❌  ${msg}`); }

function notify(title, body) {
  try {
    execSync(
      `osascript -e 'display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
      { stdio: 'ignore' },
    );
  } catch { /* notifications are optional */ }
}

function cleanLocks(profileDir) {
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch { /* ok */ }
  }
}

async function waitForEnter(prompt) {
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.once('line', () => { rl.close(); resolve(); }));
}

// ── Core refresh ─────────────────────────────────────────────────────────────

async function refreshOnce(headless = true) {
  log(`Starting refresh (headless=${headless})`);
  fs.mkdirSync(MAC_PROFILE, { recursive: true });
  cleanLocks(MAC_PROFILE);

  const context = await chromium.launchPersistentContext(MAC_PROFILE, {
    channel: 'chrome',   // use system Google Chrome — realistic fingerprint
    headless,
    ignoreDefaultArgs: ['--enable-automation', '--disable-sync'],
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    locale: 'en-US',
  });

  try {
    const page = await context.newPage();

    // ── SETUP MODE: let the user sign in manually ──────────────────────────
    if (!headless) {
      await page.goto('https://accounts.google.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      console.log('\n──────────────────────────────────────────────────────');
      console.log('  Chrome is open. Sign into riteshmeetscribe@gmail.com');
      console.log('  After signing in, visit https://meet.google.com');
      console.log('  Then come back here and press ENTER.');
      console.log('──────────────────────────────────────────────────────\n');
      await waitForEnter('Press ENTER when signed in → ');
    }

    // ── Step 1: validate session on accounts.google.com ───────────────────
    log('Checking accounts.google.com...');
    await page.goto('https://accounts.google.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    const accountsUrl = page.url();
    const signedIn =
      !accountsUrl.includes('signin') &&
      !accountsUrl.includes('ServiceLogin') &&
      !accountsUrl.includes('identifier') &&
      !accountsUrl.includes('accountchooser');

    if (!signedIn) {
      const msg = headless
        ? 'Session expired — run: npm run session:setup'
        : 'Not signed in after setup. Please re-run with --setup.';
      err(msg);
      if (headless) {
        notify('MeetScribe session expired', 'Run: npm run session:setup in bot-worker');
      }
      return false;
    }

    log(`✅ Signed in (${accountsUrl.split('?')[0]})`);

    // ── Step 2: warm up Meet to refresh Meet identity tokens ───────────────
    log('Warming up meet.google.com...');
    await page.goto('https://meet.google.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(4000);
    log(`meet.google.com → ${page.url()}`);

    // ── Step 3: export cookies ─────────────────────────────────────────────
    const all = await context.cookies([
      'https://google.com',
      'https://accounts.google.com',
      'https://meet.google.com',
      'https://workspace.google.com',
      'https://myaccount.google.com',
    ]);

    const googleCookies = all.filter(
      c => c.domain.endsWith('.google.com') || c.domain === 'google.com',
    );

    if (googleCookies.length === 0) {
      err('No Google cookies found — session may be invalid.');
      return false;
    }

    const json = JSON.stringify(googleCookies, null, 2);

    for (const out of [COOKIES_OUT, COOKIES_OUT2]) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, json);
    }

    log(`✅ Exported ${googleCookies.length} cookies → ${COOKIES_OUT}`);
    return true;

  } finally {
    await context.close();
    cleanLocks(MAC_PROFILE);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── --setup: one-time sign-in flow ────────────────────────────────────────
  if (SETUP_MODE) {
    console.log('\n🔑  MeetScribe Session Setup');
    console.log('────────────────────────────');
    const ok = await refreshOnce(false).catch(e => { err(e.message); return false; });
    if (ok) {
      console.log('\n✅  Setup complete!');
      console.log('    Profile saved at:', MAC_PROFILE);
      console.log('    Cookies written to:', COOKIES_OUT);
      console.log('\n▶️   Now keep the session alive by running:');
      console.log('    npm run session:start\n');
      console.log('    Or with auto-restart on crash:');
      console.log('    npm run session:pm2\n');
    } else {
      console.log('\n❌  Setup failed. Try again.');
    }
    process.exit(ok ? 0 : 1);
  }

  // ── Normal loop: headless refresh every INTERVAL_HOURS ───────────────────
  const intervalMs = INTERVAL_HOURS * 60 * 60 * 1000;

  console.log('\n🔄  MeetScribe Session Keeper (macOS)');
  console.log('──────────────────────────────────────────────');
  console.log(`Profile : ${MAC_PROFILE}`);
  console.log(`Output  : ${COOKIES_OUT}`);
  console.log(`Interval: every ${INTERVAL_HOURS} hours`);
  console.log('──────────────────────────────────────────────\n');

  // Check profile exists (user must have run --setup first)
  if (!fs.existsSync(MAC_PROFILE)) {
    err('No saved profile found. Run setup first:');
    err('  npm run session:setup');
    process.exit(1);
  }

  while (true) {
    const ok = await refreshOnce(true).catch(e => {
      err(`Uncaught error: ${e.message}`);
      return false;
    });

    if (!ok) {
      warn(`Refresh failed. Retrying in 30 minutes...`);
      await new Promise(r => setTimeout(r, 30 * 60 * 1000));
    } else {
      log(`Next refresh in ${INTERVAL_HOURS} hours.`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
}

main();
