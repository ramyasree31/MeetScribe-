import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

async function getToken() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

// GET /api/meetings/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let res: Response
  try {
    res = await fetch(`${API_BASE}/meetings/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return NextResponse.json({ error: 'API server unreachable' }, { status: 503 })
  }
  const text = await res.text().catch(() => '')
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  // Remap Prisma bot.failureReason → bot.errorMsg expected by the UI
  if (data?.bot?.failureReason !== undefined) {
    data.bot.errorMsg = data.bot.failureReason
  }
  return NextResponse.json(data, { status: res.status })
}

// DELETE /api/meetings/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const res = await fetch(`${API_BASE}/meetings/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => null)
  return NextResponse.json(data, { status: res.status })
}

// POST /api/meetings/:id/dispatch — immediately send bot to meeting
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let res: Response
  try {
    res = await fetch(`${API_BASE}/meetings/${id}/dispatch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return NextResponse.json({ error: 'API server unreachable. Is the backend running?' }, { status: 503 })
  }

  const text = await res.text().catch(() => '')
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { error: text } }
  return NextResponse.json(data, { status: res.status })
}

