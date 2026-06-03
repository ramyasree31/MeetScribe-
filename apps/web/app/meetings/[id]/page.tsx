'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface Meeting {
  id: string
  title: string
  platform: 'MEET' | 'ZOOM' | 'TEAMS'
  meetingUrl: string
  status: string
  startTime: string | null
  createdAt: string
  summary: { overview: string; keyDecisions?: string[]; actionItems?: string[] } | null
  bot: { status: string; containerId: string | null; errorMsg?: string | null } | null
}

function fmtDate(d: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(d))
}

const platformLabel: Record<string, string> = {
  MEET: 'Google Meet', ZOOM: 'Zoom', TEAMS: 'Microsoft Teams',
}
const platformIcon: Record<string, string> = {
  MEET: '🟢', ZOOM: '🔵', TEAMS: '🟣',
}

const statusConfig: Record<string, { label: string; bg: string; text: string; dot: string; pulse: boolean }> = {
  SCHEDULED:  { label: 'Scheduled',  bg: 'bg-accent-light', text: 'text-accent',  dot: 'bg-accent',  pulse: false },
  JOINING:    { label: 'Joining…',   bg: 'bg-[#fdeee8]',    text: 'text-warn',    dot: 'bg-warn',    pulse: true  },
  LIVE:       { label: 'Live Now',   bg: 'bg-[#fdeee8]',    text: 'text-warn',    dot: 'bg-warn',    pulse: true  },
  PROCESSING: { label: 'Processing', bg: 'bg-accent-light', text: 'text-accent2', dot: 'bg-accent2', pulse: true  },
  DONE:       { label: 'Completed',  bg: 'bg-accent-light', text: 'text-accent',  dot: 'bg-accent',  pulse: false },
  FAILED:     { label: 'Failed',     bg: 'bg-cream2',       text: 'text-ink3',    dot: 'bg-ink3',    pulse: false },
}

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [dispatchSuccess, setDispatchSuccess] = useState(false)
  // Track previous status to detect transitions
  const prevStatusRef = useRef<string | null>(null)

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${id}`)
      if (res.status === 404) { setNotFound(true); return }
      if (res.ok) {
        const data = await res.json()
        const prevStatus = prevStatusRef.current
        prevStatusRef.current = data.status

        // Auto-redirect to the live/summary page when the meeting ends
        // Transition: JOINING or LIVE → DONE or PROCESSING means the bot is done
        const wasActive = prevStatus && ['JOINING', 'LIVE'].includes(prevStatus)
        const isNowFinished = ['DONE', 'PROCESSING'].includes(data.status)
        if (wasActive && isNowFinished) {
          router.push(`/meetings/${id}/live`)
          return
        }

        setMeeting(data)
      }
    } finally {
      setLoading(false)
    }
  }, [id, router])

  const sendBotNow = async () => {
    setDispatching(true)
    setDispatchError(null)
    setDispatchSuccess(false)
    try {
      const res = await fetch(`/api/meetings/${id}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDispatchError(data?.error ?? data?.message ?? `Error ${res.status}`)
      } else {
        setDispatchSuccess(true)
        // Refresh meeting data immediately
        await fetchMeeting()
      }
    } catch (err: any) {
      setDispatchError(err?.message ?? 'Network error — is the API running?')
    } finally {
      setDispatching(false)
    }
  }

  useEffect(() => {
    fetchMeeting()
    // Poll every 5 s while bot is active
    const iv = setInterval(() => {
      fetchMeeting()
    }, 5000)
    return () => clearInterval(iv)
  }, [fetchMeeting])

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    )
  }

  if (notFound || !meeting) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center text-center px-4">
        <div className="text-5xl mb-4">🔍</div>
        <h1 className="font-serif text-2xl text-ink mb-2">Meeting not found</h1>
        <p className="text-sm text-ink3 mb-6">This meeting may have been deleted or doesn't exist.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="bg-accent text-cream rounded-full px-6 py-2.5 text-sm font-medium hover:bg-accent2 transition-colors duration-200"
        >
          ← Back to Dashboard
        </button>
      </div>
    )
  }

  const cfg = statusConfig[meeting.status] ?? statusConfig['SCHEDULED']
  const isActive = ['JOINING', 'LIVE', 'PROCESSING'].includes(meeting.status)
  const isDone   = meeting.status === 'DONE'

  return (
    <div className="min-h-screen bg-cream font-sans">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-10 px-6 md:px-10 py-4 flex items-center justify-between bg-cream/90 backdrop-blur-md border-b border-accent/10">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 font-serif text-xl text-ink hover:text-accent transition-colors duration-200"
        >
          <span className="w-2 h-2 rounded-full bg-accent inline-block" />
          MeetScribe
        </button>
        <button
          onClick={() => router.push('/dashboard')}
          className="text-sm text-ink3 hover:text-ink transition-colors duration-200"
        >
          ← Dashboard
        </button>
      </nav>

      <main className="max-w-[720px] mx-auto px-6 py-12 space-y-6">

        {/* ── Header card ── */}
        <div className="bg-white rounded-2xl border border-cream2 p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cream border border-cream2 flex items-center justify-center text-2xl">
                {platformIcon[meeting.platform] ?? '📹'}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-widest text-accent mb-1">
                  {platformLabel[meeting.platform]}
                </div>
                <h1 className="font-serif text-2xl text-ink leading-tight">{meeting.title}</h1>
              </div>
            </div>

            {/* Status pill */}
            <div className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-[customPulse_1.4s_infinite]' : ''}`} />
              {cfg.label}
            </div>
          </div>

          {/* Meta */}
          <div className="mt-6 pt-6 border-t border-cream2 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-ink3 mb-1">Meeting Link</div>
              <a
                href={meeting.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline break-all leading-relaxed"
              >
                {meeting.meetingUrl}
              </a>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-ink3 mb-1">
                {meeting.startTime ? 'Scheduled For' : 'Created'}
              </div>
              <div className="text-ink2">
                {meeting.startTime ? fmtDate(meeting.startTime) : fmtDate(meeting.createdAt)}
              </div>
            </div>
          </div>

          {/* Bot status row */}
          {meeting.bot && (
            <div className="mt-4 pt-4 border-t border-cream2 flex items-center gap-2 text-sm text-ink3">
              <span>🤖</span>
              <span>
                Bot status: <span className="font-medium text-ink2">{meeting.bot.status}</span>
                {meeting.bot.containerId && (
                  <span className="ml-2 font-mono text-[11px] text-ink3 bg-cream2 rounded px-1.5 py-0.5">
                    {meeting.bot.containerId.slice(0, 12)}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Dispatch error / success banners */}
          {dispatchError && (
            <div className="mt-5 bg-[#fdeee8] border border-warn/20 rounded-xl px-4 py-3 text-sm text-warn flex items-start gap-2">
              <span className="mt-0.5">⚠️</span>
              <span>{dispatchError}</span>
            </div>
          )}
          {dispatchSuccess && (
            <div className="mt-5 bg-accent-light border border-accent/20 rounded-xl px-4 py-3 text-sm text-accent flex items-center gap-2">
              <span>✅</span>
              <span>Bot dispatched! It's joining the meeting now…</span>
            </div>
          )}

          {/* CTA buttons */}
          <div className="mt-6 flex gap-3 flex-wrap items-center">
            {isActive && (
              <button
                onClick={() => router.push(`/meetings/${id}/live`)}
                className="flex items-center gap-2 bg-warn text-cream rounded-full px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90 hover:-translate-y-px shadow-[0_4px_16px_rgba(200,75,31,0.3)]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cream animate-[customPulse_1.4s_infinite]" />
                Watch Live
              </button>
            )}
            {isDone && meeting.summary && (
              <button
                onClick={() => router.push(`/meetings/${id}/live`)}
                className="bg-accent text-cream rounded-full px-6 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-accent2 hover:-translate-y-px shadow-[0_4px_16px_rgba(26,92,58,0.25)]"
              >
                View Summary →
              </button>
            )}

            {/* ── SEND BOT NOW button (SCHEDULED or ERROR state) ── */}
            {(meeting.status === 'SCHEDULED' || meeting.status === 'ERROR' || meeting.status === 'FAILED' || meeting.status === 'JOINING') && (
              <button
                onClick={sendBotNow}
                disabled={dispatching}
                className="flex items-center gap-2 bg-accent text-cream rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-accent2 hover:-translate-y-px shadow-[0_4px_16px_rgba(26,92,58,0.3)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {dispatching ? (
                  <>
                    <span className="w-4 h-4 rounded-full border-2 border-cream border-t-transparent animate-spin" />
                    Dispatching…
                  </>
                ) : (
                  <>
                    🤖 Send Bot Now
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* ── Summary card (if done) ── */}
        {isDone && meeting.summary && (
          <div className="bg-white rounded-2xl border border-cream2 p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
            <div className="text-xs font-semibold uppercase tracking-widest text-accent mb-4">AI Summary</div>

            <p className="text-sm text-ink2 leading-relaxed mb-6">{meeting.summary.overview}</p>

            {meeting.summary.keyDecisions && meeting.summary.keyDecisions.length > 0 && (
              <div className="mb-5">
                <div className="text-xs font-semibold uppercase tracking-widest text-ink3 mb-3">Key Decisions</div>
                <ul className="space-y-2">
                  {meeting.summary.keyDecisions.map((d, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink2">
                      <span className="text-accent mt-0.5">📋</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {meeting.summary.actionItems && meeting.summary.actionItems.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-ink3 mb-3">Action Items</div>
                <ul className="space-y-2">
                  {meeting.summary.actionItems.map((a, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink2">
                      <span className="text-accent mt-0.5">✅</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Waiting / status info card ── */}
        {(meeting.status === 'SCHEDULED' || meeting.status === 'FAILED' || meeting.status === 'ERROR') && (
          <div className="bg-white rounded-2xl border border-cream2 p-8 shadow-[0_4px_20px_rgba(0,0,0,0.04)] text-center">
            <div className="w-14 h-14 rounded-full bg-accent-light flex items-center justify-center text-2xl mx-auto mb-4">
              {meeting.status === 'SCHEDULED' ? '🤖' : '⚠️'}
            </div>
            <h2 className="font-serif text-lg text-ink mb-2">
              {meeting.status === 'SCHEDULED'
                ? 'Meeting is ready — send your bot!'
                : 'Bot failed to join'}
            </h2>
            <p className="text-sm text-ink3 mb-6 max-w-sm mx-auto">
              {meeting.status === 'SCHEDULED'
                ? 'Click "Send Bot Now" above to immediately dispatch the AI bot to your Google Meet. Make sure your meeting is already started.'
                : 'The bot encountered an error. Check that Docker Desktop is running and your meeting link is valid, then retry.'}
            </p>
            {meeting.bot?.errorMsg && (
              <div className="bg-cream2 rounded-lg px-4 py-3 text-xs font-mono text-ink3 text-left max-w-sm mx-auto break-all">
                {meeting.bot.errorMsg}
              </div>
            )}
            <p className="text-xs text-ink3 mt-4">This page refreshes every 5 seconds.</p>
          </div>
        )}

      </main>
    </div>
  )
}
