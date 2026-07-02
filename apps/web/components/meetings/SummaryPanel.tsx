'use client'

import { useEffect, useState } from 'react'
import { Socket } from 'socket.io-client'

interface SpeakerSummary {
  speaker: string
  summary: string
  decisions: string
}

interface SummaryData {
  overview: string
  speakerSummaries: SpeakerSummary[]
  actionItems: { owner: string; task: string; dueDate: string }[]
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value)) return value as T
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  return fallback
}

async function fetchSummary(meetingId: string) {
  const res = await fetch(`/api/summaries/${meetingId}`)
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.overview || data.overview.startsWith('No transcript')) return null
  return {
    overview: data.overview ?? '',
    speakerSummaries: parseJsonField<SpeakerSummary[]>(data.participants, []),
    actionItems: parseJsonField<SummaryData['actionItems']>(data.actionItems, []),
  }
}

export function SummaryPanel({ socket, meetingId }: { socket: Socket; meetingId: string }) {
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [notAvailable, setNotAvailable] = useState(false)

  // Load existing summary immediately on mount (for completed meetings)
  useEffect(() => {
    fetchSummary(meetingId)
      .then(data => {
        if (data) setSummary(data)
        else setNotAvailable(true)
      })
      .catch(() => setNotAvailable(true))
  }, [meetingId])

  // Also update when the AI finishes during a live meeting
  useEffect(() => {
    socket.on('summary_ready', async () => {
      const data = await fetchSummary(meetingId).catch(() => null)
      if (data) { setSummary(data); setNotAvailable(false) }
    })
    return () => { socket.off('summary_ready') }
  }, [socket, meetingId])


  if (!summary) {
    if (notAvailable) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <span className="text-4xl">📝</span>
          <p className="text-sm font-medium text-gray-700">Summary not available</p>
          <p className="text-xs text-gray-400 max-w-xs">
            The AI summary could not be generated. Check that your API key is configured, then re-run the meeting.
          </p>
        </div>
      )
    }
    return (
      <div className="space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-4 w-5/6 rounded bg-gray-200" />
        </div>
        <div className="space-y-3">
          <div className="h-5 w-32 rounded bg-gray-200" />
          <div className="h-10 w-full rounded-md bg-gray-100" />
          <div className="h-10 w-full rounded-md bg-gray-100" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-2 font-semibold text-gray-900">Overview</h3>
        <p className="text-sm leading-relaxed text-gray-700">{summary.overview}</p>
      </section>

      {summary.speakerSummaries.length > 0 && (
        <section>
          <h3 className="mb-3 font-semibold text-gray-900">Participants</h3>
          <div className="space-y-4">
            {summary.speakerSummaries.map((s, i) => (
              <div key={i} className="rounded-lg border bg-white p-4 shadow-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">{s.speaker}</p>
                <p className="mb-2 text-sm text-gray-700">{s.summary}</p>
                {s.decisions && (
                  <div className="mt-2 rounded-md bg-amber-50 px-3 py-2">
                    <p className="text-xs font-medium text-amber-700">Decision / Opinion</p>
                    <p className="mt-0.5 text-sm text-amber-900">{s.decisions}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 font-semibold text-gray-900">Action Items</h3>
        {summary.actionItems.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No action items identified in this meeting.</p>
        ) : (
          <ul className="space-y-3">
            {summary.actionItems.map((item, i) => (
              <li key={i} className="flex flex-col gap-1 rounded-md border bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    @{item.owner}
                  </span>
                  {item.dueDate && <span className="text-xs text-red-500">{item.dueDate}</span>}
                </div>
                <p className="text-sm text-gray-800">{item.task}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
