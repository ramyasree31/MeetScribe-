import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as any

  const supabase = await createClient()
  const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

  if (code) {
    // OAuth / PKCE flow (Google, GitHub, etc.)
    const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && user) {
      const session = (await supabase.auth.getSession()).data.session
      await fetch(`${apiBase}/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email: user.email, supabaseId: user.id }),
      }).catch(console.error)
    }
  } else if (tokenHash && type) {
    // Magic link / OTP token_hash flow
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error) {
      console.error('verifyOtp error:', error.message)
      return NextResponse.redirect(`${origin}/login?error=invalid_token`)
    }
    const user = data?.user
    const session = data?.session
    if (user && session) {
      await fetch(`${apiBase}/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: user.email, supabaseId: user.id }),
      }).catch(console.error)
    }
  }

  return NextResponse.redirect(`${origin}/dashboard`)
}

