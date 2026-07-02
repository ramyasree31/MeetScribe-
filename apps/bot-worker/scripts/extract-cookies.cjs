/**
 * Runs inside the bot-worker Docker container.
 * Launches Chrome with the bot001 profile, visits Google, exports all
 * Google cookies to cookies.json in the bot001-fresh profile directory.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROFILE_DIR   = process.env.PROFILE_DIR   || '/app/profiles/bot001';
const COOKIES_OUT   = process.env.COOKIES_OUT   || '/app/profiles/bot001-fresh/cookies.json';

(async () => {
  console.log(`Reading profile: ${PROFILE_DIR}`);
  console.log(`Writing cookies: ${COOKIES_OUT}`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const page = await context.newPage();

  // Visit Google to load session cookies into memory
  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const url = page.url();
  console.log(`Google URL: ${url}`);
  if (url.includes('signin') || url.includes('identifier')) {
    console.error('ERROR: Not signed in — VNC auth may not have saved the profile properly.');
    await context.close();
    process.exit(1);
  }

  const cookies = await context.cookies([
    'https://accounts.google.com',
    'https://meet.google.com',
    'https://myaccount.google.com',
  ]);

  fs.mkdirSync(path.dirname(COOKIES_OUT), { recursive: true });
  fs.writeFileSync(COOKIES_OUT, JSON.stringify(cookies, null, 2));
  console.log(`✅ Exported ${cookies.length} cookies to ${COOKIES_OUT}`);

  await context.close();
})().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
