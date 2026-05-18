'use client'

import { useEffect, useState, useRef } from 'react'
import { Socket } from 'socket.io-client'
import { motion } from 'framer-motion'

interface Segment {
  speaker: string
  text: string
  startMs: number
}

const colors = ['bg-blue-100 text-blue-800', 'bg-green-100 text-green-800', 'bg-purple-100 text-purple-800', 'bg-orange-100 text-orange-800']

export function LiveTranscriptFeed({ socket }: { socket: Socket }) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    socket.on('segment', (data: Segment) => {
      setSegments(prev => [...prev, data])
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
    const num = parseInt(speaker.replace(/\D/g, '')) || 0
    return colors[num % colors.length]
  }

  const formatTime = (ms: number) => {
    const date = new Date(ms)
    return date.toISOString().substr(11, 8)
  }

  return (
    <div 
      className="relative h-full overflow-y-auto pr-4" 
      onScroll={handleScroll} 
      ref={containerRef}
    >
      <div className="space-y-4 pb-20">
        {segments.map((seg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col gap-1 rounded-lg bg-gray-50 p-4"
          >
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getSpeakerColor(seg.speaker)}`}>
                {seg.speaker}
              </span>
              <span className="text-xs text-gray-400">{formatTime(seg.startMs)}</span>
            </div>
            <p className="text-gray-700">{seg.text}</p>
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
