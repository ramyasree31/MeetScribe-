import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
