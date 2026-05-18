import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b p-4">Dashboard</header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  )
}
