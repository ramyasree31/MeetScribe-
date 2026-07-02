/**
 * token-cipher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AES-256-GCM symmetric encryption for OAuth tokens stored in the database.
 *
 * Format: base64( iv[12] | authTag[16] | ciphertext[n] )
 *
 * Usage:
 *   process.env.TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 chars).
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, } from 'crypto';
const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV recommended for GCM
const TAG_LEN = 16; // 128-bit auth tag
function getEncryptionKey() {
    const hex = process.env.TOKEN_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
            'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return Buffer.from(hex, 'hex');
}
/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded string safe to store in the database.
 */
export function encryptToken(plaintext) {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Layout: iv | tag | ciphertext
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}
/**
 * Decrypt a base64-encoded ciphertext produced by `encryptToken`.
 * Throws if the ciphertext has been tampered with (GCM auth tag mismatch).
 */
export function decryptToken(ciphertext) {
    const key = getEncryptionKey();
    const buf = Buffer.from(ciphertext, 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) {
        throw new Error('Encrypted token is too short — data may be corrupt');
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const encrypted = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
    ]).toString('utf8');
}
/**
 * Constant-time equality check for tokens to prevent timing attacks.
 */
export function safeTokenEqual(a, b) {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length)
        return false;
    return timingSafeEqual(ba, bb);
}
