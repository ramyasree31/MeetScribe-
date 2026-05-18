import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  if (code) {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && user) {
      // Upsert the Supabase user into our Prisma User table via API call
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          email: user.email,
          supabaseId: user.id
        })
      }).catch(console.error) // Fire and forget or handle properly
    }
  }

  return NextResponse.redirect(`${origin}/dashboard`)
}
