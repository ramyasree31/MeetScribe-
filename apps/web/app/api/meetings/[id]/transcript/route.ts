import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Redis from 'ioredis'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

function getRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  return new Redis(url, { lazyConnect: true, enableOfflineQueue: false })
}

function parseRedisTranscript(raw: string, speakerNamesRaw: string | null) {
  let speakerNames: Record<string, string> = {}
  if (speakerNamesRaw) {
    try { speakerNames = JSON.parse(speakerNamesRaw) } catch {}
  }
  const segments = raw
    .split('\n')
    .filter(line => line.trim().match(/^\[.+\]\s+\S/))
    .map((line, i) => {
      const match = line.match(/^\[([^\]]+)\]\s+(.+)$/)
      if (!match) return null
      const rawLabel = match[1]
      const speaker = speakerNames[rawLabel] ?? rawLabel
      return { speaker, text: match[2].trim(), startMs: i * 1000 }
    })
    .filter(Boolean)
  return { segments, speakerNames }
}

// GET /api/meetings/:id/transcript
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Try Redis first (live meetings have fresh data here)
  const redis = getRedis()
  try {
    await redis.connect()
    const [raw, speakerNamesRaw] = await Promise.all([
      redis.get(`transcript:${id}`),
      redis.get(`speaker_names:${id}`),
    ])
    if (raw) {
      const result = parseRedisTranscript(raw, speakerNamesRaw)
      if (result.segments.length > 0) {
        return NextResponse.json(result)
      }
    }
  } catch {
    // Redis unreachable — fall through to NestJS API
  } finally {
    redis.disconnect()
  }

  // 2. Fall back to NestJS API — meetings/:id includes transcript from DB via Prisma
  try {
    const res = await fetch(`${API_BASE}/meetings/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (res.ok) {
      const meeting = await res.json()
      const content: any[] = meeting?.transcript?.content ?? []
      if (content.length > 0) {
        const segments = content.map((seg: any, i: number) => ({
          speaker: seg.speaker ?? 'Speaker 0',
          text: seg.text ?? '',
          startMs: seg.startMs ?? i * 1000,
        }))
        return NextResponse.json({ segments, speakerNames: {} })
      }
    }
  } catch {
    // NestJS unreachable
  }

  return NextResponse.json({ segments: [], speakerNames: {} })
}
