import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Redis from 'ioredis'

function getRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379'
  return new Redis(url, { lazyConnect: true, enableOfflineQueue: false })
}

// PATCH /api/meetings/:id/speakers
// Body: { "Speaker 0": "Ritesh", "Speaker 1": "John" }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const redis = getRedis()
  try {
    await redis.connect()
    await redis.set(`speaker_names:${id}`, JSON.stringify(body))
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    redis.disconnect()
  }
}
