/**
 * failure-classifier.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Classifies Google Meet join failures into strongly-typed reasons.
 * Each reason maps to a distinct MeetingState in the FSM.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { MeetingState } from './state-machine';
// ─────────────────────────────────────────────────────────────────────────────
export var JoinFailureReason;
(function (JoinFailureReason) {
    /** Host clicked "Deny" in the lobby admission dialog. */
    JoinFailureReason["HOST_DENIED"] = "HOST_DENIED";
    /** Google Workspace admin policy blocks outside participants. */
    JoinFailureReason["DOMAIN_RESTRICTED"] = "DOMAIN_RESTRICTED";
    /** Meeting requires a signed-in account. */
    JoinFailureReason["AUTH_REQUIRED"] = "AUTH_REQUIRED";
    /** Bot's Google session has expired and needs re-authentication. */
    JoinFailureReason["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    /** Bot Google account is suspended or rate-limited by Google. */
    JoinFailureReason["BOT_ACCOUNT_LOCKED"] = "BOT_ACCOUNT_LOCKED";
    /** Google is rate-limiting requests from this IP or account. */
    JoinFailureReason["RATE_LIMITED"] = "RATE_LIMITED";
    /** Navigation timeout or DNS / network issue. */
    JoinFailureReason["NETWORK_ERROR"] = "NETWORK_ERROR";
    /** Meeting does not exist or link is invalid. */
    JoinFailureReason["MEETING_NOT_FOUND"] = "MEETING_NOT_FOUND";
    /** Meeting has already ended before the bot could join. */
    JoinFailureReason["MEETING_ENDED_EARLY"] = "MEETING_ENDED_EARLY";
    /** Could not be classified into any known reason. */
    JoinFailureReason["UNKNOWN"] = "UNKNOWN";
})(JoinFailureReason || (JoinFailureReason = {}));
/** Maps a failure reason to the appropriate FSM terminal state. */
export const FAILURE_TO_STATE = {
    [JoinFailureReason.HOST_DENIED]: MeetingState.REJECTED,
    [JoinFailureReason.DOMAIN_RESTRICTED]: MeetingState.DOMAIN_RESTRICTED,
    [JoinFailureReason.AUTH_REQUIRED]: MeetingState.SESSION_EXPIRED,
    [JoinFailureReason.SESSION_EXPIRED]: MeetingState.SESSION_EXPIRED,
    [JoinFailureReason.BOT_ACCOUNT_LOCKED]: MeetingState.BOT_LOCKED,
    [JoinFailureReason.RATE_LIMITED]: MeetingState.RATE_LIMITED,
    [JoinFailureReason.NETWORK_ERROR]: MeetingState.NETWORK_ERROR,
    [JoinFailureReason.MEETING_NOT_FOUND]: MeetingState.FAILED,
    [JoinFailureReason.MEETING_ENDED_EARLY]: MeetingState.FAILED,
    [JoinFailureReason.UNKNOWN]: MeetingState.FAILED,
};
// ─────────────────────────────────────────────────────────────────────────────
// Text patterns visible in the browser that indicate a specific failure
// ─────────────────────────────────────────────────────────────────────────────
const REJECTION_PATTERNS = [
    {
        texts: ["You can't join this video call"],
        reason: JoinFailureReason.DOMAIN_RESTRICTED,
        quickOnly: true,
    },
    {
        texts: ["You can't join this video call"],
        reason: JoinFailureReason.HOST_DENIED,
        quickOnly: false,
    },
    {
        texts: [
            'You have been removed from the meeting',
            'You were removed from the meeting',
        ],
        reason: JoinFailureReason.HOST_DENIED,
    },
    {
        texts: ['This call has ended', 'The video call ended'],
        reason: JoinFailureReason.MEETING_ENDED_EARLY,
    },
    {
        texts: ['No valid meet code'],
        reason: JoinFailureReason.MEETING_NOT_FOUND,
    },
    {
        texts: ['Sign in to join', 'You must be signed in'],
        reason: JoinFailureReason.AUTH_REQUIRED,
    },
];
export class FailureClassifier {
    _networkSignals = [];
    _joinClickedAt = null;
    /** Call this when the user clicks "Ask to join" / "Join now". */
    markJoinClicked() {
        this._joinClickedAt = Date.now();
    }
    /**
     * Attach to the page to capture network-level rejection signals.
     * Must be called before navigation.
     */
    attachToPage(page) {
        page.on('response', (res) => {
            const status = res.status();
            const url = res.url();
            if (status >= 400 &&
                (url.includes('meet.google.com') || url.includes('googleapis.com'))) {
                this._networkSignals.push({ status, url, timestamp: Date.now() });
                console.log(`[FailureClassifier] Network signal: ${status} → ${url}`);
            }
        });
    }
    /**
     * Inspect the current page and classify the failure reason.
     * Returns null if no failure is detected (call is still in progress).
     */
    async classify(page) {
        const url = page.url();
        const elapsed = this._joinClickedAt ? Date.now() - this._joinClickedAt : Infinity;
        const bodyText = await page.innerText('body').catch(() => '');
        // ── 1. Session expiry — redirected to Google login ─────────────────────
        if (url.includes('accounts.google.com') ||
            url.includes('google.com/ServiceLogin') ||
            url.includes('signin/identifier')) {
            return JoinFailureReason.SESSION_EXPIRED;
        }
        // ── 2. Network-level signals ───────────────────────────────────────────
        const has403 = this._networkSignals.some(s => s.status === 403);
        const has429 = this._networkSignals.some(s => s.status === 429);
        if (has429)
            return JoinFailureReason.RATE_LIMITED;
        // 403 on CreateMeetingDevice = server-side auth rejection
        const hasDeviceError = this._networkSignals.some(s => s.status === 403 && s.url.includes('CreateMeetingDevice'));
        if (hasDeviceError)
            return JoinFailureReason.AUTH_REQUIRED;
        // ── 3. Page text patterns ──────────────────────────────────────────────
        for (const pattern of REJECTION_PATTERNS) {
            const matchesText = pattern.texts.some(t => bodyText.includes(t));
            if (!matchesText)
                continue;
            // Domain restriction = instant rejection (< 3 s after clicking join)
            if (pattern.quickOnly) {
                if (elapsed < 3000) {
                    return JoinFailureReason.DOMAIN_RESTRICTED;
                }
                return JoinFailureReason.HOST_DENIED;
            }
            return pattern.reason;
        }
        // ── 4. Page URL patterns ───────────────────────────────────────────────
        // Meet redirects away from the meeting URL when a guest is kicked
        if (url.includes('meet.google.com') &&
            !url.match(/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
            return JoinFailureReason.MEETING_ENDED_EARLY;
        }
        // No failure detected
        return null;
    }
    /** Human-readable description for a failure reason. */
    static describe(reason) {
        const descriptions = {
            [JoinFailureReason.HOST_DENIED]: 'The meeting host manually denied the bot entry.',
            [JoinFailureReason.DOMAIN_RESTRICTED]: 'The Google Workspace admin policy blocks participants outside the organisation.',
            [JoinFailureReason.AUTH_REQUIRED]: 'Google Meet requires a signed-in account. Bot session may be invalid.',
            [JoinFailureReason.SESSION_EXPIRED]: 'The bot Google session has expired. Re-authentication required.',
            [JoinFailureReason.BOT_ACCOUNT_LOCKED]: 'The bot Google account has been suspended or blocked.',
            [JoinFailureReason.RATE_LIMITED]: 'Google is rate-limiting requests. The bot will cool down.',
            [JoinFailureReason.NETWORK_ERROR]: 'Could not connect to Google Meet (DNS / network / timeout).',
            [JoinFailureReason.MEETING_NOT_FOUND]: 'The meeting link is invalid or the meeting does not exist.',
            [JoinFailureReason.MEETING_ENDED_EARLY]: 'The meeting ended before the bot could join.',
            [JoinFailureReason.UNKNOWN]: 'An unclassified error occurred. Check bot logs for details.',
        };
        return descriptions[reason];
    }
}
