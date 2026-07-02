'use client'

import { useState } from 'react'

const BADGE_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-pink-100 text-pink-800 border-pink-200',
]

interface SpeakerNamerProps {
  meetingId: string
  /** Unique speaker labels found in transcript, e.g. ["Speaker 0", "Speaker 1"] */
  speakers: string[]
  /** Current name overrides — may already have some filled from auto-detection */
  initialNames: Record<string, string>
  onSaved: (names: Record<string, string>) => void
}

export function SpeakerNamer({ meetingId, speakers, initialNames, onSaved }: SpeakerNamerProps) {
  const [names, setNames] = useState<Record<string, string>>(() => ({ ...initialNames }))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(true)

  if (speakers.length === 0) return null

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`/api/meetings/${meetingId}/speakers`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(names),
      })
      onSaved(names)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      // non-fatal
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 overflow-hidden">
      {/* Header */}
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">🎙️</span>
          <span className="text-sm font-semibold text-indigo-800">Name the speakers</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-600">
            {speakers.length} detected
          </span>
        </div>
        <span className="text-xs text-indigo-400">{open ? '▲ hide' : '▼ show'}</span>
      </button>

      {open && (
        <div className="border-t border-indigo-100 px-4 pb-4 pt-3 space-y-2">
          <p className="text-xs text-indigo-500 mb-3">
            Assign real names to each voice — transcript will update immediately.
          </p>

          {speakers.map((speaker, i) => {
            const color = BADGE_COLORS[i % BADGE_COLORS.length]
            const currentName = names[speaker] ?? ''
            const isGeneric = speaker.startsWith('Speaker ')

            return (
              <div key={speaker} className="flex items-center gap-3">
                {/* Original label badge */}
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
                  {speaker}
                </span>

                {/* Name input */}
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={currentName}
                    placeholder={isGeneric ? 'Enter name…' : speaker}
                    onChange={e => setNames(prev => ({ ...prev, [speaker]: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                  {currentName && (
                    <button
                      onClick={() => setNames(prev => ({ ...prev, [speaker]: '' }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          <div className="flex items-center justify-end gap-3 pt-2">
            {saved && (
              <span className="text-xs text-emerald-600 font-medium">✓ Names saved</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : 'Save names'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
