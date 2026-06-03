'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ScheduleMeetingModal } from '@/components/meetings/ScheduleMeetingModal'

// ── Native date helpers (no date-fns) ─────────────────────────────────────
function fmtDate(d: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(d))
}
function timeAgo(d: string) {
  const secs = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

interface Meeting {
  id: string
  title: string
  platform: 'MEET' | 'ZOOM' | 'TEAMS'
  meetingUrl: string
  status: string
  startTime: string | null
  createdAt: string
  summary: { overview: string } | null
  bot: { status: string; containerId: string | null } | null
}

const statusConfig: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  SCHEDULED:  { label: 'Scheduled',  bg: 'bg-accent-light', text: 'text-accent',  dot: 'bg-accent' },
  JOINING:    { label: 'Joining',    bg: 'bg-[#fdeee8]',    text: 'text-warn',    dot: 'bg-warn animate-[customPulse_2s_infinite]' },
  LIVE:       { label: 'Live',       bg: 'bg-[#fdeee8]',    text: 'text-warn',    dot: 'bg-warn animate-[customPulse_1.4s_infinite]' },
  PROCESSING: { label: 'Processing', bg: 'bg-accent-light', text: 'text-accent2', dot: 'bg-accent2 animate-[customPulse_2s_infinite]' },
  DONE:       { label: 'Completed',  bg: 'bg-accent-light', text: 'text-accent',  dot: 'bg-accent' },
  FAILED:     { label: 'Failed',     bg: 'bg-cream2',       text: 'text-ink3',    dot: 'bg-ink3' },
}

const platformLabel: Record<string, string> = {
  MEET: 'Google Meet', ZOOM: 'Zoom', TEAMS: 'Teams',
}
const platformIcon: Record<string, string> = {
  MEET: '🟢', ZOOM: '🔵', TEAMS: '🟣',
}

export default function DashboardPage() {
  const router = useRouter()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings')
      if (res.ok) setMeetings(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMeetings() }, [fetchMeetings])

  const activeMeetings = meetings.filter((m) => ['JOINING', 'LIVE', 'PROCESSING'].includes(m.status))
  const pastMeetings   = meetings.filter((m) => ['DONE', 'FAILED'].includes(m.status))
  const scheduled      = meetings.filter((m) => m.status === 'SCHEDULED')

  return (
    <div className="min-h-screen bg-cream font-sans">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-10 px-6 md:px-10 py-4 flex items-center justify-between bg-cream/90 backdrop-blur-md border-b border-accent/10">
        <div className="flex items-center gap-2 font-serif text-xl text-ink">
          <span className="w-2 h-2 rounded-full bg-accent inline-block" />
          MeetScribe
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-accent text-cream border-none rounded-full px-5 py-2 font-sans text-sm font-medium cursor-pointer transition-all duration-200 hover:bg-accent2 hover:-translate-y-px shadow-[0_4px_16px_rgba(26,92,58,0.25)]"
        >
          + Schedule Meeting
        </button>
      </nav>

      <main className="max-w-[860px] mx-auto px-6 py-12">

        {/* ── Page heading ── */}
        <div className="mb-10 animate-[fadeUp_0.5s_ease_both]">
          <div className="text-xs font-medium uppercase tracking-widest text-accent mb-2">Dashboard</div>
          <h1 className="font-serif text-[clamp(1.8rem,3.5vw,2.6rem)] font-normal leading-tight text-ink">
            Your meetings
          </h1>
          <p className="mt-2 text-sm text-ink3">
            Paste a meeting link and the AI bot joins automatically.
          </p>
        </div>

        {loading ? (
          /* ── Skeleton ── */
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-cream2 animate-pulse" />
            ))}
          </div>

        ) : meetings.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-32 text-center animate-[fadeUp_0.6s_ease_both]">
            <div className="mb-5 w-16 h-16 rounded-full bg-accent-light flex items-center justify-center text-3xl">
              🎤
            </div>
            <h2 className="font-serif text-2xl text-ink mb-2">No meetings yet</h2>
            <p className="text-sm text-ink3 max-w-xs mb-8 leading-relaxed">
              Schedule your first meeting and the AI bot will join automatically, transcribe in real time, and deliver structured notes.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="bg-accent text-cream rounded-full px-8 py-3 text-sm font-medium transition-all duration-200 hover:bg-accent2 hover:-translate-y-0.5 shadow-[0_4px_20px_rgba(26,92,58,0.25)]"
            >
              Schedule a Meeting →
            </button>
          </div>

        ) : (
          <div className="space-y-10">
            {activeMeetings.length > 0 && (
              <Section label="Live Now" dot>
                {activeMeetings.map((m) => (
                  <MeetingCard key={m.id} meeting={m} onClick={() => router.push(`/meetings/${m.id}/live`)} />
                ))}
              </Section>
            )}
            {scheduled.length > 0 && (
              <Section label="Upcoming">
                {scheduled.map((m) => (
                  <MeetingCard key={m.id} meeting={m} onClick={() => router.push(`/meetings/${m.id}`)} />
                ))}
              </Section>
            )}
            {pastMeetings.length > 0 && (
              <Section label="Past Meetings">
                {pastMeetings.map((m) => (
                  <MeetingCard key={m.id} meeting={m} onClick={() => router.push(`/meetings/${m.id}`)} />
                ))}
              </Section>
            )}
          </div>
        )}
      </main>

      <ScheduleMeetingModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={fetchMeetings}
      />
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────
function Section({ label, dot, children }: { label: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        {dot && <span className="w-1.5 h-1.5 rounded-full bg-warn animate-[customPulse_1.4s_infinite]" />}
        <span className="text-xs font-semibold uppercase tracking-widest text-ink3">{label}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

// ── MeetingCard ───────────────────────────────────────────────────────────────
function MeetingCard({ meeting, onClick }: { meeting: Meeting; onClick: () => void }) {
  const cfg = statusConfig[meeting.status] ?? statusConfig['SCHEDULED']

  return (
    <div
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-4 rounded-2xl border border-cream2 bg-white px-5 py-4 transition-all duration-200 hover:border-accent/20 hover:shadow-[0_8px_28px_rgba(0,0,0,0.07)] hover:-translate-y-0.5"
    >
      {/* Platform badge */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cream text-xl border border-cream2">
        {platformIcon[meeting.platform] ?? '📹'}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{meeting.title}</p>
        <p className="mt-0.5 text-xs text-ink3">
          {platformLabel[meeting.platform]} ·{' '}
          {meeting.startTime ? fmtDate(meeting.startTime) : timeAgo(meeting.createdAt)}
        </p>
        {meeting.summary && (
          <p className="mt-1 truncate text-xs text-ink3 italic">{meeting.summary.overview}</p>
        )}
      </div>

      {/* Status pill */}
      <div className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </div>

      {/* Arrow */}
      <span className="shrink-0 text-ink3 transition-transform duration-200 group-hover:translate-x-0.5">›</span>
    </div>
  )
}
