const PARSERS = [
  {
    platform: 'MEET',
    regex: /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
  },
  {
    platform: 'ZOOM',
    regex: /https:\/\/[a-z0-9.-]*zoom\.us\/(?:j|my)\/\d+[^\s"<>]+/i,
  },
  {
    platform: 'TEAMS',
    regex: /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i,
  },
];

export function extractMeetingLink(text: string): { url: string; platform: string } | null {
  for (const { platform, regex } of PARSERS) {
    const match = text.match(regex);
    if (match) return { url: match[0], platform };
  }
  return null;
}

export interface MinimalGoogleCalendarEvent {
  description?: string;
  location?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
}

export function parseMeetingFromCalendarEvent(event: MinimalGoogleCalendarEvent): { url: string; platform: string } | null {
  // Check conferenceData first
  const entryPoint = event.conferenceData?.entryPoints?.find(
    e => e.entryPointType === 'video'
  );
  if (entryPoint?.uri) {
    const result = extractMeetingLink(entryPoint.uri);
    if (result) return result;
  }
  // Fallback: scan description and location
  const text = [event.description ?? '', event.location ?? ''].filter(Boolean).join(' ');
  return extractMeetingLink(text);
}
