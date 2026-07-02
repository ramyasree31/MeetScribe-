/**
 * session-from-token.cjs
 *
 * Converts a stored Google OAuth2 refresh token into live browser session
 * cookies that the bot can inject into Playwright.
 *
 * Flow (same technique Chrome itself uses):
 *   1. Refresh access token from stored refresh token
 *   2. Call Google OAuthLogin endpoint → get UBERAUTH one-time code
 *   3. Open headless Playwright, navigate MergeSession with UBERAUTH
 *      → browser becomes signed in as the bot account
 *   4. Export fresh session cookies → cookies.json
 */

'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');

const CLIENT_ID   = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const TOKEN_FILE  = process.env.TOKENS_FILE  || '/app/profiles/oauth-tokens.json';
const COOKIES_OUT = process.env.COOKIES_OUT  || '/app/profiles/bot001-fresh/cookies.json';
const PROFILE_DIR = process.env.PROFILE_DIR  || '/app/profiles/bot001';

function log(msg)  { console.log(`[session-from-token] ${msg}`); }
function err(msg)  { console.error(`[session-from-token] ❌ ${msg}`); }

// ── Step 1: ensure we have a fresh access token ───────────────────────────

async function getFreshAccessToken() {
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));

  const expiresAt = (tokens.created_at || 0) + (tokens.expires_in || 3600) * 1000;
  const needsRefresh = !tokens.access_token || Date.now() > expiresAt - 60_000;

  if (!needsRefresh) {
    log('Access token still valid.');
    return tokens.access_token;
  }

  log('Refreshing access token...');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token refresh: ${data.error_description || data.error}`);

  // Persist updated tokens (refresh_token may not be returned again)
  const updated = { ...tokens, ...data, created_at: Date.now() };
  if (!updated.refresh_token) updated.refresh_token = tokens.refresh_token;
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(updated, null, 2));

  log('✅ Access token refreshed.');
  return data.access_token;
}

// ── Step 2: exchange access token for UBERAUTH one-time code ─────────────

async function getUberAuth(accessToken) {
  log('Calling Google OAuthLogin for UBERAUTH code...');

  const res = await fetch(
    'https://accounts.google.com/accounts/OAuthLogin' +
    '?service=lso&source=ChromiumBrowser&issueuberauth=1',
    {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        'User-Agent':  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      redirect: 'manual',
    }
  );

  if (!res.ok && res.status !== 302) {
    const body = await res.text();
    throw new Error(`OAuthLogin failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const body = await res.text();
  log('✅ UBERAUTH code obtained.');
  return body.trim();
}

// ── Step 3: inject UBERAUTH into headless Playwright → get session ────────

async function injectSession(uberAuth) {
  log('Injecting session into Playwright browser...');

  // Clean any stale locks
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch {}
  }

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--password-store=basic',
    ],
    ignoreDefaultArgs: ['--enable-automation', '--disable-sync'],
  });

  try {
    const page = await context.newPage();

    const mergeUrl =
      'https://accounts.google.com/MergeSession' +
      `?uberauth=${encodeURIComponent(uberAuth)}` +
      '&source=ChromiumBrowser' +
      '&continue=https://meet.google.com/';

    await page.goto(mergeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(4000);

    const finalUrl = page.url();
    log(`MergeSession landed on: ${finalUrl}`);

    if (finalUrl.includes('signin') || finalUrl.includes('ServiceLogin') || finalUrl.includes('identifier')) {
      throw new Error('MergeSession failed — browser still on sign-in page. Check OAuth scopes.');
    }

    log('✅ Browser signed in. Exporting cookies...');

    // Warm up Meet to mint Meet-specific tokens
    await page.goto('https://meet.google.com/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(3000);

    const allCookies = await context.cookies([
      'https://google.com',
      'https://accounts.google.com',
      'https://meet.google.com',
      'https://workspace.google.com',
      'https://myaccount.google.com',
    ]);

    const google = allCookies.filter(
      c => c.domain.endsWith('.google.com') || c.domain === 'google.com'
    );

    if (google.length === 0) throw new Error('No Google cookies exported — session injection may have failed.');

    fs.mkdirSync(path.dirname(COOKIES_OUT), { recursive: true });
    fs.writeFileSync(COOKIES_OUT, JSON.stringify(google, null, 2));

    log(`✅ Exported ${google.length} cookies → ${COOKIES_OUT}`);
    return google.length;

  } finally {
    await context.close().catch(() => {});
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch {}
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function refreshSession() {
  if (!fs.existsSync(TOKEN_FILE)) {
    err('No OAuth tokens found.');
    err('Run setup first:  docker compose run --rm --service-ports bot-setup');
    err('Then open:        http://localhost:3003');
    process.exit(1);
  }

  const accessToken = await getFreshAccessToken();
  const uberAuth    = await getUberAuth(accessToken);
  await injectSession(uberAuth);
}

module.exports = { refreshSession };

// Run directly
if (require.main === module) {
  refreshSession().catch(e => { err(e.message); process.exit(1); });
}
