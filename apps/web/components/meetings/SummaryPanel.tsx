'use client'

import { useEffect, useState } from 'react'
import { Socket } from 'socket.io-client'

interface SummaryData {
  overview: string
  actionItems: { owner: string; task: string; dueDate: string }[]
  keyDecisions: string[]
}

export function SummaryPanel({ socket }: { socket: Socket }) {
  const [summary, setSummary] = useState<SummaryData | null>(null)

  useEffect(() => {
    socket.on('summary_ready', async (data: { summaryId: string }) => {
      try {
        const res = await fetch(`/api/summaries/${data.summaryId}`)
        if (res.ok) {
          const fetchedSummary = await res.json()
          setSummary(fetchedSummary)
        }
      } catch (e) {
        console.error(e)
      }
    })

    return () => {
      socket.off('summary_ready')
    }
  }, [socket])

  if (!summary) {
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

      <section>
        <h3 className="mb-3 font-semibold text-gray-900">Action Items</h3>
        <ul className="space-y-3">
          {summary.actionItems.map((item, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-md border bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                  @{item.owner}
                </span>
                <span className="text-xs text-red-500">{item.dueDate}</span>
              </div>
              <p className="text-sm text-gray-800">{item.task}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-gray-900">Key Decisions</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
          {summary.keyDecisions.map((dec, i) => (
            <li key={i}>{dec}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
