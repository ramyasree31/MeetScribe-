import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

// GET /api/summaries/:meetingId
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const res = await fetch(`${API_BASE}/summaries/${meetingId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const data = await res.json().catch(() => null)
  return NextResponse.json(data, { status: res.status })
}
