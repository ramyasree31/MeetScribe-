/**
 * profile-validator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that a Chromium persistent profile has a live, authenticated
 * Google session before allowing the bot to attempt to join a meeting.
 *
 * Why this matters:
 *   Google Meet's server-side `CreateMeetingDevice` call checks the identity
 *   token stored in the Chromium profile's IndexedDB / Cookie jar.
 *   An ephemeral context with injected cookies fails this check.
 *   A persistent profile that has undergone real OAuth login will pass it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Navigates to Google Account info page and reads the signed-in user.
 * Returns `valid: false` if redirected to sign-in.
 */
export async function validateBotSession(_context, page) {
    const VALIDATION_URL = 'https://myaccount.google.com/';
    try {
        await page.goto(VALIDATION_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 20_000,
        });
    }
    catch {
        return { valid: false, email: null, name: null, expiryRemainingMs: null };
    }
    const url = page.url();
    // Redirected to sign-in → session is not valid
    if (url.includes('accounts.google.com') ||
        url.includes('ServiceLogin') ||
        url.includes('signin/identifier')) {
        console.error('[ProfileValidator] Session invalid — redirected to sign-in');
        return { valid: false, email: null, name: null, expiryRemainingMs: null };
    }
    // Extract email and name from the page
    const { email, name } = await page.evaluate(() => {
        // Google Account page stores email in multiple locations
        const emailEl = document.querySelector('[data-email]') ||
            document.querySelector('a[href*="SignOutOptions"]');
        const email = emailEl?.getAttribute('data-email') ?? emailEl?.getAttribute('aria-label') ?? null;
        const nameEl = document.querySelector('h1') || document.querySelector('[data-name]');
        const name = nameEl?.textContent?.trim() ?? null;
        return { email, name };
    });
    if (!email) {
        // Could not find email indicator — might be a UI change; do a secondary check
        const hasAccountButton = await page
            .locator('[aria-label*="Google Account"]')
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false);
        if (!hasAccountButton) {
            console.error('[ProfileValidator] Session check inconclusive — no account indicators found');
            return { valid: false, email: null, name: null, expiryRemainingMs: null };
        }
    }
    console.log(`[ProfileValidator] ✅ Session valid — signed in as: ${email ?? 'unknown'}`);
    return {
        valid: true,
        email: email ?? null,
        name: name ?? null,
        expiryRemainingMs: null, // Google does not expose token expiry in the UI
    };
}
/**
 * Quick check against meet.google.com specifically.
 * Useful after profile is loaded but before navigation to the meeting URL.
 */
export async function validateMeetSession(page) {
    try {
        await page.goto('https://meet.google.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
        });
    }
    catch {
        return false;
    }
    const url = page.url();
    if (url.includes('accounts.google.com') ||
        url.includes('ServiceLogin') ||
        url.includes('signin/identifier')) {
        return false;
    }
    // Check for the signed-in user badge in Meet's top-right
    const isSignedIn = await page
        .locator('[aria-label*="Google Account"]')
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
    return isSignedIn;
}
/**
 * Detects whether the current page is a Google sign-in redirect.
 * Call this anytime after a navigation to catch mid-session expiry.
 */
export function isSignInPage(url) {
    return (url.includes('accounts.google.com') ||
        url.includes('google.com/accounts') ||
        url.includes('google.com/ServiceLogin') ||
        url.includes('signin/identifier'));
}
