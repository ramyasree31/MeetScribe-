'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow, format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { ScheduleMeetingModal } from '@/components/meetings/ScheduleMeetingModal'

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

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  SCHEDULED: { label: 'Scheduled', color: 'bg-blue-50 text-blue-700', dot: 'bg-blue-400' },
  JOINING:   { label: 'Joining',   color: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-400 animate-pulse' },
  LIVE:      { label: 'Live',      color: 'bg-red-50 text-red-700',    dot: 'bg-red-500 animate-pulse' },
  PROCESSING:{ label: 'Processing',color: 'bg-purple-50 text-purple-700', dot: 'bg-purple-400 animate-pulse' },
  DONE:      { label: 'Completed', color: 'bg-green-50 text-green-700', dot: 'bg-green-500' },
  FAILED:    { label: 'Failed',    color: 'bg-gray-50 text-gray-500',  dot: 'bg-gray-400' },
}

const platformIcon: Record<string, string> = {
  MEET: '🟢',
  ZOOM: '🔵',
  TEAMS: '🟣',
}

export default function DashboardPage() {
  const router = useRouter()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings')
      if (res.ok) {
        setMeetings(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMeetings()
  }, [fetchMeetings])

  const activeMeetings = meetings.filter((m) =>
    ['JOINING', 'LIVE', 'PROCESSING'].includes(m.status),
  )
  const pastMeetings = meetings.filter((m) =>
    ['DONE', 'FAILED'].includes(m.status),
  )
  const scheduled = meetings.filter((m) => m.status === 'SCHEDULED')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎙️</span>
            <span className="text-lg font-semibold text-gray-900">MeetScribe</span>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
          >
            <span className="text-base">+</span>
            Schedule Meeting
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200" />
            ))}
          </div>
        ) : meetings.length === 0 ? (
          /* ── Empty state ── */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-32 text-center"
          >
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50 text-4xl">
              🎤
            </div>
            <h2 className="mb-2 text-xl font-semibold text-gray-900">No meetings yet</h2>
            <p className="mb-6 text-gray-500">
              Schedule your first meeting and the AI bot will join automatically.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Schedule a Meeting
            </button>
          </motion.div>
        ) : (
          <div className="space-y-10">
            {/* ── Active / Live ── */}
            {activeMeetings.length > 0 && (
              <Section title="Live Now" emoji="🔴">
                {activeMeetings.map((m) => (
                  <MeetingCard key={m.id} meeting={m} onClick={() => router.push(`/meetings/${m.id}/live`)} />
                ))}
              </Section>
            )}

            {/* ── Scheduled ── */}
            {scheduled.length > 0 && (
              <Section title="Upcoming" emoji="📅">
                {scheduled.map((m) => (
                  <MeetingCard key={m.id} meeting={m} onClick={() => router.push(`/meetings/${m.id}`)} />
                ))}
              </Section>
            )}

            {/* ── Past ── */}
            {pastMeetings.length > 0 && (
              <Section title="Past Meetings" emoji="📋">
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

function Section({
  title,
  emoji,
  children,
}: {
  title: string
  emoji: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
        <span>{emoji}</span>
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function MeetingCard({ meeting, onClick }: { meeting: Meeting; onClick: () => void }) {
  const cfg = statusConfig[meeting.status] ?? statusConfig['SCHEDULED']

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
      onClick={onClick}
      className="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 transition"
    >
      {/* Platform icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-50 text-xl">
        {platformIcon[meeting.platform] ?? '📹'}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-900">{meeting.title}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {meeting.startTime
            ? format(new Date(meeting.startTime), 'MMM d, yyyy · h:mm a')
            : `Scheduled ${formatDistanceToNow(new Date(meeting.createdAt), { addSuffix: true })}`}
        </p>
        {meeting.summary && (
          <p className="mt-1 truncate text-xs text-gray-500">{meeting.summary.overview}</p>
        )}
      </div>

      {/* Status badge */}
      <div
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cfg.color}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
        {cfg.label}
      </div>

      {/* Arrow */}
      <span className="shrink-0 text-gray-300">›</span>
    </motion.div>
  )
}
