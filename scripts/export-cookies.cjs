'use strict';

const path = require('path');
const fs   = require('fs');

const playwrightPath = path.resolve(__dirname, '../apps/bot-worker/node_modules/playwright');
const { chromium } = require(playwrightPath);

const PROFILES_BASE = path.resolve(
  process.env.BOT_PROFILE_BASE_DIR || path.resolve(__dirname, '../profiles'),
);

async function exportCookies(profileId) {
  const profileDir = path.join(PROFILES_BASE, profileId);

  if (!fs.existsSync(profileDir)) {
    console.error(`Profile not found: ${profileDir}`);
    process.exit(1);
  }

  console.log(`Exporting cookies for profile: ${profileId}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,  // must be visible — headless Chrome can't decrypt macOS keychain cookies
    ignoreDefaultArgs: ['--enable-automation', '--disable-sync', '--disable-background-networking'],
    args: [
      '--no-sandbox',
      '--no-first-run',
      '--window-size=800,600',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  // Navigate to myaccount.google.com to load session cookies into memory
  try {
    await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle', timeout: 30_000 });
  } catch { /* check URL anyway */ }

  await page.waitForTimeout(2000);
  const finalUrl = page.url();
  console.log(`Session check URL: ${finalUrl}`);

  const allCookies = await context.cookies([
    'https://google.com',
    'https://accounts.google.com',
    'https://myaccount.google.com',
    'https://meet.google.com',
  ]);

  const googleCookies = allCookies.filter(
    c => c.domain.endsWith('.google.com') || c.domain === 'google.com',
  );

  const CORE = ['SID', 'SSID', 'HSID', '__Secure-1PSID', '__Secure-3PSID'];
  const hasCore = CORE.some(n => googleCookies.some(c => c.name === n));

  console.log(`Total cookies: ${allCookies.length}`);
  console.log(`Google cookies: ${googleCookies.length}`);
  console.log(`Core session cookies: ${hasCore ? '✅ present' : '❌ MISSING'}`);
  console.log(`Cookie names: ${googleCookies.map(c => c.name).join(', ')}`);

  if (!hasCore) {
    console.error('\n❌ No core session cookies found — profile not authenticated.');
    console.error('Re-run: node scripts/authenticate-bot-profile.cjs bot001');
    await context.close();
    process.exit(1);
  }

  if (!finalUrl.includes('myaccount.google.com')) {
    console.warn(`\n⚠️  myaccount.google.com check redirected to: ${finalUrl}`);
    console.warn('Core cookies are present — exporting anyway. If Meet also fails, re-authenticate.');
  }

  const cookiesPath = path.join(profileDir, 'cookies.json');
  fs.writeFileSync(cookiesPath, JSON.stringify(googleCookies, null, 2), 'utf8');
  console.log(`\n✅ Exported ${googleCookies.length} cookies → ${cookiesPath}`);

  await context.close();
}

const profileId = process.argv[2] || 'bot001';
exportCookies(profileId).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
