/**
 * state-machine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Strongly-typed FSM for the bot meeting lifecycle.
 * Each state transition is explicit and logged. Invalid transitions throw.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export var MeetingState;
(function (MeetingState) {
    MeetingState["SCHEDULED"] = "SCHEDULED";
    MeetingState["ASSIGNED"] = "ASSIGNED";
    MeetingState["LAUNCHING"] = "LAUNCHING";
    MeetingState["AUTHENTICATING"] = "AUTHENTICATING";
    MeetingState["NAVIGATING"] = "NAVIGATING";
    MeetingState["LOBBY"] = "LOBBY";
    MeetingState["WAITING_APPROVAL"] = "WAITING_APPROVAL";
    MeetingState["JOINED"] = "JOINED";
    MeetingState["RECORDING"] = "RECORDING";
    MeetingState["PROCESSING"] = "PROCESSING";
    MeetingState["COMPLETED"] = "COMPLETED";
    // ── Failure terminal states ────────────────────────────────────────────────
    MeetingState["REJECTED"] = "REJECTED";
    MeetingState["DOMAIN_RESTRICTED"] = "DOMAIN_RESTRICTED";
    MeetingState["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    MeetingState["BOT_LOCKED"] = "BOT_LOCKED";
    MeetingState["RATE_LIMITED"] = "RATE_LIMITED";
    MeetingState["NETWORK_ERROR"] = "NETWORK_ERROR";
    MeetingState["FAILED"] = "FAILED";
})(MeetingState || (MeetingState = {}));
/** All states that are terminal (no further transitions allowed). */
export const TERMINAL_STATES = new Set([
    MeetingState.COMPLETED,
    MeetingState.REJECTED,
    MeetingState.DOMAIN_RESTRICTED,
    MeetingState.SESSION_EXPIRED,
    MeetingState.BOT_LOCKED,
    MeetingState.RATE_LIMITED,
    MeetingState.NETWORK_ERROR,
    MeetingState.FAILED,
]);
/** All failure terminal states. */
export const FAILURE_STATES = new Set([
    MeetingState.REJECTED,
    MeetingState.DOMAIN_RESTRICTED,
    MeetingState.SESSION_EXPIRED,
    MeetingState.BOT_LOCKED,
    MeetingState.RATE_LIMITED,
    MeetingState.NETWORK_ERROR,
    MeetingState.FAILED,
]);
/**
 * Valid transitions map.
 * Key = current state, Value = set of allowed next states.
 */
const TRANSITIONS = {
    [MeetingState.SCHEDULED]: new Set([MeetingState.ASSIGNED, MeetingState.FAILED]),
    [MeetingState.ASSIGNED]: new Set([MeetingState.LAUNCHING, MeetingState.FAILED]),
    [MeetingState.LAUNCHING]: new Set([MeetingState.AUTHENTICATING, MeetingState.NETWORK_ERROR, MeetingState.FAILED]),
    [MeetingState.AUTHENTICATING]: new Set([MeetingState.NAVIGATING, MeetingState.SESSION_EXPIRED, MeetingState.BOT_LOCKED, MeetingState.FAILED]),
    [MeetingState.NAVIGATING]: new Set([MeetingState.LOBBY, MeetingState.NETWORK_ERROR, MeetingState.SESSION_EXPIRED, MeetingState.FAILED]),
    [MeetingState.LOBBY]: new Set([MeetingState.WAITING_APPROVAL, MeetingState.FAILED, MeetingState.NETWORK_ERROR]),
    [MeetingState.WAITING_APPROVAL]: new Set([MeetingState.JOINED, MeetingState.REJECTED, MeetingState.DOMAIN_RESTRICTED, MeetingState.RATE_LIMITED, MeetingState.NETWORK_ERROR, MeetingState.FAILED]),
    [MeetingState.JOINED]: new Set([MeetingState.RECORDING, MeetingState.FAILED, MeetingState.NETWORK_ERROR]),
    [MeetingState.RECORDING]: new Set([MeetingState.PROCESSING, MeetingState.FAILED, MeetingState.NETWORK_ERROR]),
    [MeetingState.PROCESSING]: new Set([MeetingState.COMPLETED, MeetingState.FAILED]),
    // Terminal states have no outgoing transitions
    [MeetingState.COMPLETED]: new Set(),
    [MeetingState.REJECTED]: new Set(),
    [MeetingState.DOMAIN_RESTRICTED]: new Set(),
    [MeetingState.SESSION_EXPIRED]: new Set(),
    [MeetingState.BOT_LOCKED]: new Set(),
    [MeetingState.RATE_LIMITED]: new Set(),
    [MeetingState.NETWORK_ERROR]: new Set(),
    [MeetingState.FAILED]: new Set(),
};
export class MeetingStateMachine {
    _state;
    _meetingId;
    _handlers = [];
    _history = [];
    constructor(meetingId, initial = MeetingState.SCHEDULED) {
        this._meetingId = meetingId;
        this._state = initial;
        this._history.push({ state: initial, ts: Date.now() });
    }
    get state() {
        return this._state;
    }
    get history() {
        return [...this._history];
    }
    get isTerminal() {
        return TERMINAL_STATES.has(this._state);
    }
    get isFailed() {
        return FAILURE_STATES.has(this._state);
    }
    /** Register a listener that fires on every valid transition. */
    onTransition(handler) {
        this._handlers.push(handler);
        return this;
    }
    /**
     * Transition to a new state.
     * Throws if the transition is invalid.
     */
    async transition(next, meta) {
        const allowed = TRANSITIONS[this._state];
        if (!allowed.has(next)) {
            throw new Error(`[StateMachine] Invalid transition: ${this._state} → ${next} (meetingId=${this._meetingId})`);
        }
        const from = this._state;
        this._state = next;
        this._history.push({ state: next, ts: Date.now() });
        console.log(`[StateMachine] ${this._meetingId}: ${from} → ${next}` +
            (meta ? ` | ${JSON.stringify(meta)}` : ''));
        for (const handler of this._handlers) {
            await handler(from, next, this._meetingId, meta);
        }
    }
    /**
     * Safely attempt a transition — logs a warning instead of throwing
     * if the transition is not valid. Useful in catch blocks.
     */
    async tryTransition(next, meta) {
        const allowed = TRANSITIONS[this._state];
        if (!allowed.has(next)) {
            console.warn(`[StateMachine] Skipped invalid transition: ${this._state} → ${next} (meetingId=${this._meetingId})`);
            return false;
        }
        await this.transition(next, meta);
        return true;
    }
}
