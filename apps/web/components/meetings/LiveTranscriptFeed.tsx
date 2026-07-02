'use client'

import { useEffect, useState, useRef } from 'react'
import { Socket } from 'socket.io-client'
import { motion } from 'framer-motion'
import { SpeakerNamer } from './SpeakerNamer'

interface Segment {
  speaker: string
  text: string
  startMs: number
}

const colors = ['bg-blue-100 text-blue-800', 'bg-green-100 text-green-800', 'bg-purple-100 text-purple-800', 'bg-orange-100 text-orange-800']

export function LiveTranscriptFeed({
  socket,
  meetingId,
  isDone,
  speakerNames: initialSpeakerNames = {},
  onSpeakerNamesSaved,
}: {
  socket: Socket
  meetingId: string
  isDone?: boolean
  speakerNames?: Record<string, string>
  onSpeakerNamesSaved?: (names: Record<string, string>) => void
}) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>(initialSpeakerNames)
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep local speakerNames in sync if parent updates (e.g. on initial load)
  useEffect(() => {
    setSpeakerNames(initialSpeakerNames)
  }, [JSON.stringify(initialSpeakerNames)])

  // Load transcript history from Redis on mount (works for both live and done meetings).
  // Real-time WebSocket `segment` events then append new segments on top.
  useEffect(() => {
    setHistoryLoading(true)
    fetch(`/api/meetings/${meetingId}/transcript`)
      .then(r => r.json())
      .then(data => {
        if (data.segments?.length) setSegments(data.segments)
        if (data.speakerNames && Object.keys(data.speakerNames).length > 0) {
          setSpeakerNames(prev => ({ ...data.speakerNames, ...prev }))
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [meetingId])

  useEffect(() => {
    socket.on('segment', (data: Segment) => {
      setSegments(prev => {
        // Skip if this text already exists at the tail (duplicate from Redis pre-load race)
        const last = prev[prev.length - 1]
        if (last && last.speaker === data.speaker && last.text === data.text) return prev
        return [...prev, data]
      })
    })

    return () => {
      socket.off('segment')
    }
  }, [socket])

  useEffect(() => {
    if (isAutoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [segments, isAutoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setIsAutoScroll(isAtBottom)
  }

  const getSpeakerColor = (speaker: string) => {
    const resolved = speakerNames[speaker] ?? speaker
    const num = parseInt(speaker.replace(/\D/g, '')) || Array.from(resolved).reduce((a, c) => a + c.charCodeAt(0), 0)
    return colors[num % colors.length]
  }

  const formatTime = (ms: number) => {
    const date = new Date(ms)
    return date.toISOString().substring(11, 19)
  }

  // Collect unique raw speaker labels in order of first appearance
  const uniqueSpeakers = Array.from(new Set(segments.map(s => s.speaker)))

  function handleSpeakerNamesSaved(newNames: Record<string, string>) {
    setSpeakerNames(prev => ({ ...prev, ...newNames }))
    onSpeakerNamesSaved?.(newNames)
  }

  // Group consecutive segments from the same speaker into paragraphs
  const grouped = segments.reduce<{ speaker: string; texts: string[]; startMs: number }[]>((acc, seg) => {
    const last = acc[acc.length - 1]
    if (last && last.speaker === seg.speaker) {
      last.texts.push(seg.text)
    } else {
      acc.push({ speaker: seg.speaker, texts: [seg.text], startMs: seg.startMs })
    }
    return acc
  }, [])

  if (grouped.length === 0) {
    if (historyLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="text-4xl">{isDone ? '🔇' : '🎙️'}</span>
        <p className="text-sm font-medium text-gray-700">
          {isDone ? 'No transcript captured' : 'Waiting for speech…'}
        </p>
        <p className="text-xs text-gray-400 max-w-xs">
          {isDone
            ? 'The bot joined but no speech was detected. Make sure you speak after the bot is admitted.'
            : 'Transcript will appear here in real time as participants speak.'}
        </p>
      </div>
    )
  }

  return (
    <div
      className="relative h-full overflow-y-auto pr-4"
      onScroll={handleScroll}
      ref={containerRef}
    >
      <div className="space-y-4 pb-20">
        {/* Speaker name editor — only shown for completed meetings */}
        {isDone && (
          <SpeakerNamer
            meetingId={meetingId}
            speakers={uniqueSpeakers}
            initialNames={speakerNames}
            onSaved={handleSpeakerNamesSaved}
          />
        )}

        {grouped.map((group) => (
          <motion.div
            key={`${group.speaker}-${group.startMs}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col gap-1 rounded-lg bg-gray-50 p-4"
          >
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getSpeakerColor(group.speaker)}`}>
                {speakerNames[group.speaker] ?? group.speaker}
              </span>
              <span className="text-xs text-gray-400">{formatTime(group.startMs)}</span>
            </div>
            <p className="text-gray-700">{group.texts.join(' ')}</p>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!isAutoScroll && (
        <button
          onClick={() => setIsAutoScroll(true)}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-gray-800 px-4 py-2 text-sm text-white shadow-lg transition-transform hover:scale-105"
        >
          Scroll paused • Click to resume
        </button>
      )}
    </div>
  )
}
