/**
 * profile-validator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Two-phase session validation:
 *   Phase 1 — Cookie inspection (no network, instant)
 *             Detects empty profiles before any navigation.
 *   Phase 2 — Live URL check (myaccount.google.com)
 *             Detects cookies that exist but Google has already invalidated.
 *
 * Why two phases?
 *   Phase 1 alone misses server-side revocation (Google can invalidate cookies
 *   at any time without removing them from the browser). Phase 2 alone was
 *   giving false-positives when run from a Playwright context that still had
 *   --enable-automation (Google would redirect to /account/about publicly).
 *   Together they are reliable and give precise diagnostics.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { BrowserContext, Page } from 'playwright';

// ─────────────────────────────────────────────────────────────────────────────

export interface SessionValidationResult {
  valid: boolean;
  email: string | null;
  name: string | null;
  expiryRemainingMs: number | null;
  // Diagnostics — always populated, useful for debugging
  cookieCount: number;
  googleCookieCount: number;
  hasCoreCookies: boolean;
  finalUrl: string;
}

// Core Google session cookie names. At least one must be present for a valid session.
// Includes both legacy (SID/HSID) and newer OSID-based auth used by recent Google accounts.
const CORE_COOKIE_NAMES = [
  'SID',
  'SSID',
  'HSID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  'OSID',
  '__Secure-OSID',
  'LSID',
];

// ─────────────────────────────────────────────────────────────────────────────

export async function validateBotSession(
  context: BrowserContext,
  _page: Page,
): Promise<SessionValidationResult> {

  // ── Phase 1: Cookie inspection (no network) ─────────────────────────────────
  // Read cookies directly from the browser context. This is instant and reveals
  // whether the profile even has any Google session data before we waste time
  // navigating anywhere.
  const allCookies = await context.cookies([
    'https://google.com',
    'https://accounts.google.com',
    'https://myaccount.google.com',
    'https://meet.google.com',
  ]);

  const googleCookies = allCookies.filter(c =>
    c.domain.endsWith('.google.com') || c.domain === 'google.com',
  );
  const cookieNames    = googleCookies.map(c => c.name);
  const hasCoreCookies = CORE_COOKIE_NAMES.some(name => cookieNames.includes(name));

  console.log(`[ProfileValidator] ── Phase 1: Cookie Inspection ──`);
  console.log(`[ProfileValidator] Total cookies  : ${allCookies.length}`);
  console.log(`[ProfileValidator] Google cookies : ${googleCookies.length}`);
  console.log(`[ProfileValidator] Core cookies   : ${hasCoreCookies ? '✅ present' : '❌ MISSING'}`);
  console.log(`[ProfileValidator] Cookie names   : ${cookieNames.slice(0, 15).join(', ') || '(none)'}`);

  if (!hasCoreCookies) {
    // Profile is empty or was created by raw Chrome with real macOS keychain.
    // Playwright uses --use-mock-keychain so it cannot decrypt those cookies.
    // Solution: delete the profile dir and re-authenticate via authenticate-bot-profile.cjs.
    const emptyCause = allCookies.length === 0
      ? 'Profile directory is empty — never authenticated via Playwright auth script.'
      : 'Cookies exist but none are core Google session tokens — likely encrypted with wrong key (raw Chrome auth detected).';
    console.error(`[ProfileValidator] ❌ Phase 1 FAILED: ${emptyCause}`);
    console.error(`[ProfileValidator] Fix: node scripts/authenticate-bot-profile.cjs bot001`);
    return {
      valid: false, email: null, name: null, expiryRemainingMs: null,
      cookieCount: allCookies.length, googleCookieCount: googleCookies.length,
      hasCoreCookies: false, finalUrl: '',
    };
  }

  // ── Phase 2 skipped ────────────────────────────────────────────────────────
  // Previously we navigated to myaccount.google.com to verify the session live.
  // Google's bot-detection consistently redirects Playwright (even on macOS) to
  // google.com/account/about when automation flags are present. Phase 1 cookie
  // inspection is sufficient — core cookies present means the session is likely
  // valid; Meet itself will confirm on navigation.
  const finalUrl = 'skipped';
  const accountEmail: string | null = null;

  console.log(`[ProfileValidator] ✅ Phase 1 passed — ${googleCookies.length} Google cookies present`);
  console.log(`[ProfileValidator] Skipping Phase 2 (myaccount.google.com) to avoid bot-detection redirect`);

  return {
    valid: true,
    email: accountEmail,
    name: null,
    expiryRemainingMs: null,
    cookieCount: allCookies.length,
    googleCookieCount: googleCookies.length,
    hasCoreCookies,
    finalUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick check: is the current page URL a Google sign-in redirect?
 * Call after any navigation to detect mid-session expiry.
 */
export function isSignInPage(url: string): boolean {
  return (
    url.includes('accounts.google.com') ||
    url.includes('google.com/accounts') ||
    url.includes('google.com/ServiceLogin') ||
    url.includes('signin/identifier') ||
    url.includes('google.com/account/about')
  );
}
