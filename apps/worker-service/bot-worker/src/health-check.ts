import { chromium } from 'playwright';
import { validateBotSession } from './profile-validator';
import path from 'path';
import fs from 'fs';

export async function runHealthCheck(): Promise<void> {
  const profileDir = process.env.BOT_PROFILE_DIR;
  if (!profileDir) {
    console.error('HEALTH_CHECK_ERROR: BOT_PROFILE_DIR environment variable is required');
    process.exit(1);
  }

  const resolvedDir = path.resolve(profileDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`HEALTH_CHECK_FAILED: Profile directory not found: ${resolvedDir}`);
    process.exit(2);
  }

  console.log(`[health-check] Checking session in: ${resolvedDir}`);

  let context;
  try {
    context = await chromium.launchPersistentContext(resolvedDir, {
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await context.newPage();
    const session = await validateBotSession(context, page);

    if (session.valid) {
      console.log(`HEALTH_CHECK_OK: Session valid for ${session.email}`);
      process.exit(0);
    } else {
      console.error('HEALTH_CHECK_FAILED: Session invalid or expired');
      process.exit(2);
    }
  } catch (err: any) {
    console.error(`HEALTH_CHECK_ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}
