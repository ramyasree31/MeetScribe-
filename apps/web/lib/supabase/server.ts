import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )

  // Bypass authentication: always return a mock user
  const mockUser = {
    id: '9acb7070-d837-4df0-a97e-d2162f357736',
    email: 'riteshshingre@gmail.com',
    role: 'authenticated',
  };

  const mockSession = {
    access_token: 'mock_token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'mock_refresh_token',
    user: mockUser,
  };

  client.auth.getUser = async (jwt?: string) => {
    return { data: { user: mockUser as any }, error: null };
  };

  client.auth.getSession = async () => {
    return { data: { session: mockSession as any }, error: null };
  };

  return client
}
