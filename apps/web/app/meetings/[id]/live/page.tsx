'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { io, Socket } from 'socket.io-client'
import { createClient } from '@/lib/supabase/client'
import { LiveTranscriptFeed } from '@/components/meetings/LiveTranscriptFeed'
import { MeetingStatusBanner } from '@/components/meetings/MeetingStatusBanner'
import { SummaryPanel } from '@/components/meetings/SummaryPanel'
import { motion } from 'framer-motion'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'

type Tab = 'transcript' | 'summary'
type MeetingStatus = 'SCHEDULED' | 'JOINING' | 'LIVE' | 'PROCESSING' | 'DONE' | 'FAILED'

export default function LiveMeetingPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('transcript')
  const [title, setTitle] = useState<string>('Meeting')
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>('LIVE')
  const [meetingEnded, setMeetingEnded] = useState(false)

  // Poll meeting status to detect when meeting ends
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/meetings/${id}`)
      if (!res.ok) return
      const data = await res.json()
      const status: MeetingStatus = data.status
      setMeetingStatus(status)
      if (data.title) setTitle(data.title)

      if (status === 'DONE') {
        setMeetingEnded(true)
        setActiveTab('summary')
      }
    } catch (_) {}
  }, [id])

  useEffect(() => {
    let socket: Socket

    async function connect() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      // Fetch meeting title + initial status
      pollStatus()

      socket = io(WS_URL, {
        auth: { token: session.access_token },
        transports: ['websocket'],
      })

      socket.on('connect', () => {
        setConnected(true)
        socket.emit('join_meeting', id)
      })

      socket.on('disconnect', () => setConnected(false))

      // Auto-switch to summary tab when the AI finishes
      socket.on('summary_ready', () => {
        setMeetingEnded(true)
        setActiveTab('summary')
        setMeetingStatus('DONE')
      })

      socketRef.current = socket
    }

    connect()

    // Poll every 5s to detect meeting end (fallback for missed WebSocket events)
    const pollInterval = setInterval(pollStatus, 5000)

    return () => {
      clearInterval(pollInterval)
      if (socketRef.current) {
        socketRef.current.emit('leave_meeting', id)
        socketRef.current.disconnect()
      }
    }
  }, [id, router, pollStatus])

  const isDone = meetingStatus === 'DONE'
  const isActive = ['JOINING', 'LIVE', 'PROCESSING'].includes(meetingStatus)

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ── Meeting Ended Banner ── */}
      {meetingEnded && (
        <div className="shrink-0 bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <span className="text-xl">✅</span>
            <div>
              <p className="text-white font-semibold text-sm">Meeting has ended</p>
              <p className="text-emerald-100 text-xs">The AI summary is ready below</p>
            </div>
          </div>
          <button
            onClick={() => router.push(`/meetings/${id}`)}
            className="text-xs text-emerald-100 hover:text-white underline transition-colors"
          >
            View full details →
          </button>
        </div>
      )}

      {/* ── Status Banner (only while active) ── */}
      {!meetingEnded && (
        <div className="shrink-0">
          <MeetingStatusBanner meetingId={id} />
        </div>
      )}

      {/* ── Sub-header ── */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            ← Dashboard
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-sm font-semibold text-gray-800">{title}</h1>
        </div>

        <div className="flex items-center gap-2">
          {isDone && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Completed
            </span>
          )}
          {isActive && (
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                connected ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                }`}
              />
              {connected ? 'Live' : 'Connecting…'}
            </div>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex shrink-0 gap-1 border-b border-gray-100 bg-white px-6">
        {(['transcript', 'summary'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-3 text-sm font-medium capitalize transition ${
              activeTab === tab ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'transcript' ? '📝 Live Transcript' : '✨ AI Summary'}
            {activeTab === tab && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600"
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden">
        {!connected && !isDone ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
              <p className="text-sm text-gray-500">Connecting to live stream…</p>
            </div>
          </div>
        ) : (
          <div className="h-full">
            {activeTab === 'transcript' && socketRef.current && (
              <div className="h-full p-6">
                <LiveTranscriptFeed socket={socketRef.current} />
              </div>
            )}
            {activeTab === 'summary' && socketRef.current && (
              <div className="h-full overflow-y-auto p-6">
                <SummaryPanel socket={socketRef.current} meetingId={id} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

