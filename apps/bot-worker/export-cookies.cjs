const { chromium } = require('playwright');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TEMP_PROFILE = '/tmp/bot-google-auth-' + Date.now();
const OUT1 = path.join(__dirname, 'profiles', 'bot001', 'cookies.json');
const OUT2 = path.join(__dirname, 'profiles', 'bot001-fresh', 'cookies.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  console.log('Launching Chrome (not automated — Google will accept it)...\n');

  exec(`"${CHROME}" \
    --remote-debugging-port=9222 \
    --user-data-dir="${TEMP_PROFILE}" \
    --password-store=basic \
    --no-first-run \
    --no-default-browser-check \
    "https://accounts.google.com/"`);

  await new Promise(r => setTimeout(r, 3000));

  console.log('Chrome is open. Log in with riteshmeetscribe@gmail.com');
  console.log('After logging in:');
  console.log('  1. Go to https://meet.google.com (you should see your meetings list)');
  console.log('  2. Come back here and press ENTER...\n');

  const rl = readline.createInterface({ input: process.stdin });
  await new Promise(resolve => rl.once('line', resolve));
  rl.close();

  console.log('Reading cookies...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];

  const allCookies = await ctx.cookies([
    'https://google.com',
    'https://accounts.google.com',
    'https://myaccount.google.com',
    'https://meet.google.com',
    'https://workspace.google.com',
  ]);

  const googleCookies = allCookies.filter(
    c => c.domain.endsWith('.google.com') || c.domain === 'google.com'
  );

  await browser.close();

  if (googleCookies.length === 0) {
    console.error('No Google cookies found — make sure you were logged in before pressing Enter.');
    process.exit(1);
  }

  const json = JSON.stringify(googleCookies, null, 2);
  fs.mkdirSync(path.dirname(OUT1), { recursive: true });
  fs.writeFileSync(OUT1, json);
  fs.mkdirSync(path.dirname(OUT2), { recursive: true });
  fs.writeFileSync(OUT2, json);
  console.log(`\nExported ${googleCookies.length} cookies → ${OUT1}`);
  console.log(`Exported ${googleCookies.length} cookies → ${OUT2}`);
  console.log('Done! The bot is ready to use.');
})();
