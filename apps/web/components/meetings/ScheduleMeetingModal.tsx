'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Platform = 'MEET' | 'ZOOM' | 'TEAMS'

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

const platformOptions: { value: Platform; label: string; icon: string }[] = [
  { value: 'MEET',  label: 'Google Meet', icon: '🟢' },
  { value: 'ZOOM',  label: 'Zoom',        icon: '🔵' },
  { value: 'TEAMS', label: 'Teams',       icon: '🟣' },
]

export function ScheduleMeetingModal({ isOpen, onClose, onCreated }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    platform: 'MEET' as Platform,
    meetingUrl: '',
    startTime: '',
  })

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          platform: form.platform,
          meetingUrl: form.meetingUrl,
          startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
        }),
      })

      // Safely parse — never crash on empty/non-JSON bodies
      const text = await res.text().catch(() => '')
      let data: any = {}
      try { data = text ? JSON.parse(text) : {} } catch { data = { error: text || 'Unknown error' } }

      if (!res.ok) {
        throw new Error(data?.message || data?.error || `Server error (${res.status})`)
      }

      onCreated()
      onClose()
      if (data?.id) router.push(`/meetings/${data.id}`)
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm"
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-cream border border-cream2 p-8 shadow-[0_40px_80px_rgba(0,0,0,0.2)]">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-accent mb-1">New Meeting</div>
              <h2 className="font-serif text-2xl font-normal text-ink">Schedule the AI bot</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-ink3 hover:bg-cream2 transition-colors duration-200 text-lg"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-ink3">
            The bot joins automatically when the meeting starts.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-ink3 mb-2">
              Meeting Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Q3 Product Review"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-xl border border-cream2 bg-white px-4 py-3 text-sm text-ink outline-none transition-all duration-200 focus:border-accent focus:ring-2 focus:ring-accent/10 placeholder:text-ink3"
            />
          </div>

          {/* Platform */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-ink3 mb-2">
              Platform
            </label>
            <div className="grid grid-cols-3 gap-2">
              {platformOptions.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setForm({ ...form, platform: p.value })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-semibold transition-all duration-200 ${
                    form.platform === p.value
                      ? 'border-accent bg-accent-light text-accent shadow-[0_2px_8px_rgba(26,92,58,0.15)]'
                      : 'border-cream2 bg-white text-ink3 hover:border-accent/30 hover:bg-cream'
                  }`}
                >
                  <span className="text-xl">{p.icon}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Meeting URL */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-ink3 mb-2">
              Meeting Link
            </label>
            <input
              type="url"
              required
              placeholder="https://meet.google.com/abc-defg-hij"
              value={form.meetingUrl}
              onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
              className="w-full rounded-xl border border-cream2 bg-white px-4 py-3 text-sm text-ink outline-none transition-all duration-200 focus:border-accent focus:ring-2 focus:ring-accent/10 placeholder:text-ink3"
            />
          </div>

          {/* Start Time */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-ink3 mb-2">
              Start Time{' '}
              <span className="normal-case font-normal text-ink3">(leave blank to join now)</span>
            </label>
            <input
              type="datetime-local"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              className="w-full rounded-xl border border-cream2 bg-white px-4 py-3 text-sm text-ink outline-none transition-all duration-200 focus:border-accent focus:ring-2 focus:ring-accent/10"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-[#fdeee8] border border-warn/20 px-4 py-3 text-sm text-warn">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border border-cream2 bg-white py-3 text-sm font-medium text-ink2 transition-all duration-200 hover:bg-cream hover:border-ink3"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-full bg-accent py-3 text-sm font-medium text-cream transition-all duration-200 hover:bg-accent2 disabled:opacity-60 shadow-[0_4px_16px_rgba(26,92,58,0.25)]"
            >
              {loading ? 'Scheduling…' : 'Schedule Bot →'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
