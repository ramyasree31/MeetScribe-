'use client'

import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { createClient } from '@/lib/supabase/client'
import { MeetingStatusBanner } from '@/components/meetings/MeetingStatusBanner'
import { LiveTranscriptFeed } from '@/components/meetings/LiveTranscriptFeed'
import { SummaryPanel } from '@/components/meetings/SummaryPanel'

export default function LiveMeetingPage({ params }: { params: { id: string } }) {
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => {
    const supabase = createClient()
    
    const initSocket = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const newSocket = io(process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001', {
        auth: {
          token: session.access_token
        }
      })

      newSocket.on('connect', () => {
        newSocket.emit('join_meeting', params.id)
      })

      setSocket(newSocket)
    }

    initSocket()

    return () => {
      if (socket) {
        socket.emit('leave_meeting', params.id)
        socket.disconnect()
      }
    }
  }, [params.id])

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <MeetingStatusBanner meetingId={params.id} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto border-r bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Live Transcript</h2>
          {socket && <LiveTranscriptFeed socket={socket} />}
        </div>
        <div className="w-96 overflow-y-auto bg-gray-50 p-6">
          <h2 className="mb-4 text-xl font-semibold">Meeting Summary</h2>
          {socket && <SummaryPanel socket={socket} />}
        </div>
      </div>
    </div>
  )
}
