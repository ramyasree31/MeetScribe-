/**
 * Cookie keepalive — runs every 12 hours via docker-compose `cookie-keeper` service.
 *
 * Injects saved cookies into a headless browser, visits Google's servers, then
 * writes back the refreshed cookies (with extended expiry) to disk.
 * As long as this runs at least once every ~30 days the session never expires.
 */
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PROFILES_DIR = process.env.BOT_PROFILES_BASE_DIR || '/app/profiles';
const PROFILE_DIRS = ['bot001-fresh', 'bot001'];

async function main() {
  const cookiesPath = path.join(PROFILES_DIR, 'bot001-fresh', 'cookies.json');

  if (!fs.existsSync(cookiesPath)) {
    console.error('[keepalive] cookies.json not found at', cookiesPath);
    console.error('[keepalive] Run:  docker compose run --rm --service-ports bot-auth');
    process.exit(1);
  }

  const savedCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
  console.log(`[keepalive] Loaded ${savedCookies.length} cookies — checking session...`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();

  try {
    await context.addCookies(savedCookies);
    const page = await context.newPage();

    // Hit myaccount to verify session
    await page.goto('https://myaccount.google.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const url = page.url();
    if (url.includes('/ServiceLogin') || url.includes('/signin') || url.includes('/v3/signin')) {
      console.error('[keepalive] ❌ Session expired — re-authenticate with:');
      console.error('[keepalive]    docker compose run --rm --service-ports bot-auth');
      process.exit(1);
    }

    console.log('[keepalive] ✅ Session valid — touching Google Meet to extend expiry...');

    // Touch Meet so those domain cookies are also refreshed
    await page.goto('https://meet.google.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Collect the refreshed cookies
    const fresh = await context.cookies([
      'https://google.com',
      'https://accounts.google.com',
      'https://meet.google.com',
      'https://workspace.google.com',
    ]);
    const google = fresh.filter(
      c => c.domain.endsWith('.google.com') || c.domain === 'google.com',
    );

    // Persist back to all profile dirs
    for (const dir of PROFILE_DIRS) {
      const outDir = path.join(PROFILES_DIR, dir);
      if (fs.existsSync(outDir)) {
        fs.writeFileSync(path.join(outDir, 'cookies.json'), JSON.stringify(google, null, 2));
      }
    }

    const maxExpiry = google
      .filter(c => c.expires > 0)
      .reduce((max, c) => Math.max(max, c.expires), 0);
    const expiresOn = maxExpiry ? new Date(maxExpiry * 1000).toDateString() : 'unknown';

    console.log(`[keepalive] ✅ Saved ${google.length} refreshed cookies`);
    console.log(`[keepalive]    Session valid until at least: ${expiresOn}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[keepalive] Fatal:', err.message);
  process.exit(1);
});
