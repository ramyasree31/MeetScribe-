import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

/** Proxy all /api/meetings requests to the NestJS backend with the user's JWT */
async function proxyToApi(request: NextRequest, path: string, init?: RequestInit) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = `${API_BASE}/${path}`

  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers ?? {}),
      },
    })
  } catch (networkErr: any) {
    // Backend is down or unreachable
    return NextResponse.json(
      { error: 'Cannot reach the API server. Make sure all backend services are running.', detail: networkErr?.message },
      { status: 503 }
    )
  }

  // Safely parse — some responses (204 etc.) have no body
  const text = await res.text().catch(() => '')
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }

  return NextResponse.json(data ?? {}, { status: res.status })
}

// GET /api/meetings  →  list
// POST /api/meetings  →  create
export async function GET(request: NextRequest) {
  return proxyToApi(request, 'meetings')
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  return proxyToApi(request, 'meetings', { method: 'POST', body: JSON.stringify(body) })
}
