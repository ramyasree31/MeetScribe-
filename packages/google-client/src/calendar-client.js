/**
 * calendar-client.ts
 * Google Calendar API client — sync events and manage push watch channels.
 */
import { PrismaClient } from '@prisma/client';
import { getValidGoogleToken } from './token-refresher';
import { randomUUID } from 'crypto';
const prisma = new PrismaClient();
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
// ─── Meeting URL extraction ───────────────────────────────────────────────────
const PLATFORM_PATTERNS = [
    { platform: 'MEET', regex: /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i },
    { platform: 'ZOOM', regex: /https:\/\/[a-z0-9.-]*zoom\.us\/j\/\d+/i },
    { platform: 'TEAMS', regex: /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i },
];
export function extractMeetingLink(text) {
    for (const { platform, regex } of PLATFORM_PATTERNS) {
        const match = text.match(regex);
        if (match)
            return { url: match[0], platform };
    }
    return null;
}
function parseMeetingFromEvent(event) {
    // 1. Prefer structured conferenceData
    const videoEntry = event.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video');
    if (videoEntry?.uri) {
        const result = extractMeetingLink(videoEntry.uri);
        if (result)
            return result;
    }
    // 2. Scan description + location
    const text = [event.description ?? '', event.location ?? ''].join(' ');
    return extractMeetingLink(text);
}
// ─── Calendar API helpers ─────────────────────────────────────────────────────
async function calendarFetch(userId, path, options = {}) {
    const token = await getValidGoogleToken(userId);
    const resp = await fetch(`${CALENDAR_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Google Calendar API error ${resp.status}: ${err}`);
    }
    return resp.json();
}
// ─── Full Sync ────────────────────────────────────────────────────────────────
/**
 * Pull all future events from the user's primary calendar and upsert to DB.
 * Returns the sync token for future incremental syncs.
 */
export async function fullCalendarSync(userId) {
    console.log(`[CalendarClient] Full sync for user ${userId}`);
    const now = new Date().toISOString();
    let pageToken;
    let syncToken;
    let totalUpserted = 0;
    do {
        const params = new URLSearchParams({
            calendarId: 'primary',
            timeMin: now,
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '250',
            ...(pageToken ? { pageToken } : {}),
        });
        const data = await calendarFetch(userId, `/calendars/primary/events?${params}`);
        await upsertCalendarEvents(userId, data.items);
        totalUpserted += data.items.length;
        pageToken = data.nextPageToken;
        syncToken = data.nextSyncToken ?? syncToken;
    } while (pageToken);
    console.log(`[CalendarClient] Full sync complete: ${totalUpserted} events for user ${userId}`);
    if (syncToken) {
        await prisma.calendarWatch.upsert({
            where: { userId },
            create: {
                userId,
                channelId: '',
                resourceId: '',
                syncToken,
                expiration: new Date(0), // Dummy until watch channel is created
            },
            update: {
                syncToken,
            },
        });
    }
    return syncToken ?? '';
}
/**
 * Pull only changes since the last sync using the stored sync token.
 */
export async function incrementalCalendarSync(userId, syncToken) {
    console.log(`[CalendarClient] Incremental sync for user ${userId}`);
    let pageToken;
    let newSyncToken = syncToken;
    do {
        const params = new URLSearchParams({
            syncToken,
            ...(pageToken ? { pageToken } : {}),
        });
        let data;
        try {
            data = await calendarFetch(userId, `/calendars/primary/events?${params}`);
        }
        catch (err) {
            const msg = err.message;
            // 410 Gone = sync token expired, must do full sync
            if (msg.includes('410')) {
                console.warn(`[CalendarClient] Sync token expired for user ${userId} — falling back to full sync`);
                return fullCalendarSync(userId);
            }
            throw err;
        }
        await upsertCalendarEvents(userId, data.items);
        pageToken = data.nextPageToken;
        newSyncToken = data.nextSyncToken ?? newSyncToken;
    } while (pageToken);
    await prisma.calendarWatch.update({
        where: { userId },
        data: { syncToken: newSyncToken },
    });
    return newSyncToken;
}
// ─── Upsert Events to DB ─────────────────────────────────────────────────────
async function upsertCalendarEvents(userId, events) {
    for (const event of events) {
        const startTime = event.start.dateTime
            ? new Date(event.start.dateTime)
            : new Date(event.start.date);
        const endTime = event.end.dateTime
            ? new Date(event.end.dateTime)
            : new Date(event.end.date);
        const meetingLink = parseMeetingFromEvent(event);
        await prisma.calendarEvent.upsert({
            where: { userId_googleEventId: { userId, googleEventId: event.id } },
            create: {
                userId,
                googleEventId: event.id,
                title: event.summary ?? '(No title)',
                startTime,
                endTime,
                meetingUrl: meetingLink?.url ?? null,
                platform: meetingLink?.platform ?? null,
                status: event.status,
                isRecurring: !!event.recurringEventId,
                recurringEventId: event.recurringEventId ?? null,
                raw: event,
            },
            update: {
                title: event.summary ?? '(No title)',
                startTime,
                endTime,
                meetingUrl: meetingLink?.url ?? null,
                platform: meetingLink?.platform ?? null,
                status: event.status,
                isRecurring: !!event.recurringEventId,
                recurringEventId: event.recurringEventId ?? null,
                raw: event,
            },
        });
        // Auto-create a Meeting record for events with a conference link
        if (meetingLink && event.status === 'confirmed' && startTime > new Date()) {
            const existing = await prisma.meeting.findFirst({
                where: { userId, meetingUrl: meetingLink.url },
            });
            if (!existing) {
                const meeting = await prisma.meeting.create({
                    data: {
                        title: event.summary ?? '(No title)',
                        platform: meetingLink.platform,
                        meetingUrl: meetingLink.url,
                        status: 'SCHEDULED',
                        startTime,
                        endTime,
                        userId,
                    },
                });
                // Link CalendarEvent → Meeting
                await prisma.calendarEvent.update({
                    where: { userId_googleEventId: { userId, googleEventId: event.id } },
                    data: { meetingId: meeting.id },
                });
                console.log(`[CalendarClient] Auto-created meeting ${meeting.id} for event "${event.summary}"`);
            }
        }
    }
}
// ─── Push Watch Channel ───────────────────────────────────────────────────────
/**
 * Register a Google Calendar push notification watch channel.
 * Google will POST to our webhook when any calendar event changes.
 */
export async function createCalendarWatch(userId) {
    const channelId = randomUUID();
    const webhookUrl = `${process.env.PUBLIC_API_URL}/api/webhooks/google-calendar`;
    // 7-day expiry (Google max is 30 days; renew weekly via cron)
    const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const data = await calendarFetch(userId, '/calendars/primary/events/watch', {
        method: 'POST',
        body: JSON.stringify({
            id: channelId,
            type: 'web_hook',
            address: webhookUrl,
            expiration: String(expiration),
        }),
    });
    await prisma.calendarWatch.upsert({
        where: { userId },
        create: {
            userId,
            channelId: data.id,
            resourceId: data.resourceId,
            expiration: new Date(Number(data.expiration)),
        },
        update: {
            channelId: data.id,
            resourceId: data.resourceId,
            expiration: new Date(Number(data.expiration)),
        },
    });
    console.log(`[CalendarClient] ✅ Watch channel created for user ${userId} (expires ${new Date(expiration).toISOString()})`);
}
/**
 * Stop a watch channel (called on OAuth disconnect or expiry).
 */
export async function stopCalendarWatch(userId) {
    const watch = await prisma.calendarWatch.findUnique({ where: { userId } });
    if (!watch)
        return;
    try {
        await calendarFetch(userId, '/channels/stop', {
            method: 'POST',
            body: JSON.stringify({ id: watch.channelId, resourceId: watch.resourceId }),
        });
    }
    catch { /* ignore — channel may already be expired */ }
    await prisma.calendarWatch.delete({ where: { userId } });
    console.log(`[CalendarClient] Watch channel stopped for user ${userId}`);
}
