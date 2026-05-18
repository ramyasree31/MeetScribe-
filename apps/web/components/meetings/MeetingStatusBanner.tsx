'use client'

import { useEffect, useState } from 'react'

export function MeetingStatusBanner({ meetingId }: { meetingId: string }) {
  const [status, setStatus] = useState<string>('JOINING')

  useEffect(() => {
    let mounted = true
    
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}`)
        if (!res.ok) return
        const data = await res.json()
        if (mounted) {
          setStatus(data.status)
        }
      } catch (err) {
        console.error(err)
      }
    }

    fetchStatus()
    const interval = setInterval(() => {
      if (status !== 'DONE' && status !== 'FAILED') {
        fetchStatus()
      }
    }, 5000)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [meetingId, status])

  const getBadgeColor = () => {
    switch (status) {
      case 'LIVE': return 'bg-red-500'
      case 'PROCESSING': return 'bg-yellow-500'
      case 'DONE': return 'bg-green-500'
      case 'FAILED': return 'bg-gray-500'
      default: return 'bg-blue-500'
    }
  }

  return (
    <div className="flex items-center justify-between border-b bg-white px-6 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`h-3 w-3 rounded-full animate-pulse ${getBadgeColor()}`} />
        <span className="font-medium text-gray-700">Status: {status}</span>
      </div>
    </div>
  )
}
