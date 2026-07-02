/**
 * token-refresher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages Google OAuth2 access tokens for user calendar integration.
 *
 * Responsibilities:
 *   - Return valid access token (refresh if needed)
 *   - Persist updated token to the database
 *   - Handle refresh failures (revoked token, account deleted)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { PrismaClient } from '@prisma/client';
import { encryptToken, decryptToken } from '@meetscribe/crypto';
const prisma = new PrismaClient();
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Refresh if less than 5 minutes remain on the token. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
export class TokenExpiredError extends Error {
    constructor(userId) {
        super(`Google OAuth token for user ${userId} has been revoked or expired permanently`);
        this.name = 'TokenExpiredError';
    }
}
/**
 * Returns a valid Google access token for the given user.
 * Refreshes automatically if within the refresh buffer window.
 * Throws `TokenExpiredError` if the refresh token is invalid.
 */
export async function getValidGoogleToken(userId) {
    const record = await prisma.oAuthToken.findUnique({
        where: { userId_provider: { userId, provider: 'google' } },
    });
    if (!record) {
        throw new Error(`No Google OAuth token found for user ${userId}. User must re-connect Google.`);
    }
    // Token still valid — return as-is
    if (new Date(record.expiresAt).getTime() > Date.now() + REFRESH_BUFFER_MS) {
        return decryptToken(record.accessToken);
    }
    // Token expired — refresh it
    console.log(`[TokenRefresher] Refreshing Google token for user ${userId}`);
    const refreshToken = decryptToken(record.refreshToken);
    const resp = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) {
        if (data.error === 'invalid_grant') {
            // Refresh token revoked — user must re-authorize
            await prisma.oAuthToken.delete({
                where: { userId_provider: { userId, provider: 'google' } },
            });
            throw new TokenExpiredError(userId);
        }
        throw new Error(`Google token refresh failed: ${data.error ?? 'unknown'} — ${data.error_description ?? ''}`);
    }
    const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
    await prisma.oAuthToken.update({
        where: { userId_provider: { userId, provider: 'google' } },
        data: {
            accessToken: encryptToken(data.access_token),
            expiresAt: newExpiry,
        },
    });
    console.log(`[TokenRefresher] ✅ Token refreshed for user ${userId}, expires: ${newExpiry.toISOString()}`);
    return data.access_token;
}
/**
 * Store a new OAuth token pair (called after the OAuth callback exchange).
 */
export async function storeGoogleToken(userId, accessToken, refreshToken, expiresIn, scopes) {
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await prisma.oAuthToken.upsert({
        where: { userId_provider: { userId, provider: 'google' } },
        create: {
            userId,
            provider: 'google',
            accessToken: encryptToken(accessToken),
            refreshToken: encryptToken(refreshToken),
            expiresAt,
            scopes,
        },
        update: {
            accessToken: encryptToken(accessToken),
            refreshToken: encryptToken(refreshToken),
            expiresAt,
            scopes,
        },
    });
    console.log(`[TokenRefresher] ✅ Google token stored for user ${userId}`);
}
/**
 * Revoke a user's Google OAuth connection.
 * This also calls Google's revocation endpoint to invalidate the refresh token.
 */
export async function revokeGoogleToken(userId) {
    const record = await prisma.oAuthToken.findUnique({
        where: { userId_provider: { userId, provider: 'google' } },
    });
    if (!record)
        return;
    // Best-effort revocation call to Google
    try {
        const refreshToken = decryptToken(record.refreshToken);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
            method: 'POST',
        });
    }
    catch { /* ignore — we delete locally regardless */ }
    await prisma.oAuthToken.delete({
        where: { userId_provider: { userId, provider: 'google' } },
    });
    console.log(`[TokenRefresher] Google token revoked for user ${userId}`);
}
