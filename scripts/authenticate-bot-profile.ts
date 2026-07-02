/**
 * authenticate-bot-profile.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time setup script: manually authenticate a dedicated bot Gmail account
 * into a Chromium persistent profile.
 *
 * Run ONCE per bot account:
 *   npx ts-node scripts/authenticate-bot-profile.ts bot001
 *   npx ts-node scripts/authenticate-bot-profile.ts bot002
 *   npx ts-node scripts/authenticate-bot-profile.ts bot003
 *
 * After this script succeeds, the profile is saved to:
 *   ./profiles/<profile-id>/
 *
 * Mount this directory as a Docker volume so bot containers can reuse it:
 *   volumes:
 *     - ./profiles:/app/profiles
 *
 * IMPORTANT:
 *   - The profile directory must be gitignored — it contains auth tokens.
 *   - In production, store profiles on a persistent volume (EBS, EFS, PVC).
 *   - Re-run this script if the bot session expires (every 14–30 days).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

// ─────────────────────────────────────────────────────────────────────────────

const PROFILES_BASE = path.resolve(
  process.env.BOT_PROFILE_BASE_DIR ?? './profiles',
);

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function authenticateBotProfile(profileId: string): Promise<void> {
  const profileDir = path.join(PROFILES_BASE, profileId);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Bot Profile One-Time Authentication Setup              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`Profile ID  : ${profileId}`);
  console.log(`Profile Dir : ${profileDir}`);

  // Create profiles directory if it doesn't exist
  if (!fs.existsSync(PROFILES_BASE)) {
    fs.mkdirSync(PROFILES_BASE, { recursive: true });
    console.log(`\n✅ Created profiles directory: ${PROFILES_BASE}`);
  }

  if (fs.existsSync(profileDir)) {
    console.log(`\n⚠️  Profile already exists at: ${profileDir}`);
    await waitForEnter('Press ENTER to re-authenticate (existing session will be overwritten), or Ctrl+C to abort: ');
  }

  console.log('\n🚀 Launching Chrome…\n');

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,          // Must be visible for manual login
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,800',
    ],
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // Navigate to Google Sign-In
  await page.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded' });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('MANUAL STEP REQUIRED:');
  console.log('');
  console.log('  1. Sign in to the dedicated bot Gmail account');
  console.log('     Example: meetingbot001@gmail.com');
  console.log('');
  console.log('  2. Complete 2FA if prompted');
  console.log('');
  console.log('  3. After login completes, navigate to: https://meet.google.com');
  console.log('');
  console.log('  4. Confirm you can see your Google Account badge in the top-right');
  console.log('');
  console.log('  5. Come back here and press ENTER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await waitForEnter('→ Press ENTER when done: ');

  // ── Validate authentication state ─────────────────────────────────────────
  console.log('\n🔍 Verifying authentication…\n');

  await page.goto('https://myaccount.google.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  });

  await page.waitForTimeout(3000);

  const url = page.url();
  const isOnSignIn =
    url.includes('accounts.google.com') ||
    url.includes('ServiceLogin') ||
    url.includes('signin/identifier');

  if (isOnSignIn) {
    console.error('❌ Authentication FAILED — still on sign-in page.');
    console.error('   Please try again and ensure you complete the full login flow.');
    await context.close();
    process.exit(1);
  }

  // Extract signed-in account details
  const { email, name } = await page.evaluate(() => {
    const emailEl = document.querySelector('[data-email]');
    const email = emailEl?.getAttribute('data-email') ?? null;
    const nameEl = document.querySelector('h1');
    const name = nameEl?.textContent?.trim() ?? null;
    return { email, name };
  });

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Authentication Successful!                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Profile ID : ${profileId}`);
  console.log(`  Email      : ${email ?? 'unknown (check manually)'}`);
  console.log(`  Name       : ${name ?? 'unknown'}`);
  console.log(`  Saved to   : ${profileDir}`);
  console.log('');
  console.log('NEXT STEPS:');
  console.log('  • Ensure profiles/ is gitignored');
  console.log('  • Mount profiles/ as a Docker volume');
  console.log('  • Set BOT_PROFILE_DIR=/app/profiles/' + profileId + ' in your bot container');
  console.log('');
  console.log('SESSION MAINTENANCE:');
  console.log('  • Sessions expire in 14–30 days of inactivity');
  console.log('  • Run this script again when the bot exits with code 2 (session expired)');
  console.log('');

  // Take a verification screenshot
  await page.goto('https://meet.google.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const screenshotPath = path.join(PROFILES_BASE, `${profileId}-verified.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  Verification screenshot saved: ${screenshotPath}`);
  console.log('');

  await context.close();
  console.log('Browser closed. Profile saved. ✅\n');
}

// ─────────────────────────────────────────────────────────────────────────────

const profileId = process.argv[2];

if (!profileId) {
  console.error('\nUsage: npx ts-node scripts/authenticate-bot-profile.ts <profile-id>');
  console.error('Example: npx ts-node scripts/authenticate-bot-profile.ts bot001\n');
  process.exit(1);
}

authenticateBotProfile(profileId).catch((err) => {
  console.error('Fatal error during authentication:', err);
  process.exit(1);
});
