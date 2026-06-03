'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [mode, setMode] = useState<'signup' | 'otp'>('otp')
  const [otpSent, setOtpSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = createClient()

  const syncUser = async (token: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
      await fetch(`${apiUrl}/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({})
      })
    } catch (e) {
      console.error('Failed to sync user:', e)
    }
  }

  // ─── OTP flow (uses our custom Resend route) ───────────────────────────────
  const handleSendOtp = async () => {
    if (!email) { setMessage({ type: 'error', text: 'Please enter your email.' }); return }
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP.')
      setOtpSent(true)
      if (data.devOtp) {
        setOtp(data.devOtp)
        setMessage({ type: 'success', text: `A 6-digit code was sent (auto-filled: ${data.devOtp}).` })
      } else {
        setMessage({ type: 'success', text: `A 6-digit code was sent to ${email}. Check your inbox!` })
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) { setMessage({ type: 'error', text: 'Enter the 6-digit code.' }); return }
    setLoading(true)
    setMessage(null)
    try {
      // Verify OTP against our server store; get back the Supabase action_link
      const res = await fetch('/api/auth/send-otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid code.')

      // Redirect browser to our local auth/callback route with the token_hash.
      // This allows the server-side callback to verify the OTP and set cookies.
      window.location.href = `/auth/callback?token_hash=${data.tokenHash}&type=${data.type}`
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message })
      setLoading(false)
    }
  }

  // ─── Password Sign In ──────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (data.session) {
        await syncUser(data.session.access_token)
        window.location.href = '/dashboard'
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Invalid credentials.' })
    } finally {
      setLoading(false)
    }
  }

  // ─── Sign Up ───────────────────────────────────────────────────────────────
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    try {
      // Disable email confirmation → sign up + immediately sign in
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (error) throw error
      if (data.session) {
        await syncUser(data.session.access_token)
        window.location.href = '/dashboard'
      } else if (data.user) {
        // No session means email confirmation is required — switch to OTP mode instead
        setMessage({
          type: 'success',
          text: 'Account created! Use the "Sign In with Code" tab to verify your email.',
        })
        setMode('otp')
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Sign up failed.' })
    } finally {
      setLoading(false)
    }
  }

  // ─── Google OAuth ──────────────────────────────────────────────────────────
  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }

  const tabClass = (active: boolean) =>
    `flex-1 py-2 text-xs font-semibold rounded-md transition-all duration-200 ${
      active
        ? 'bg-[#1a5c3a] text-[#f7f4ef] shadow'
        : 'text-[#7a7a7a] hover:text-[#0d0d0d]'
    }`

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: '#0d0d0d', fontFamily: 'var(--font-dm-sans), system-ui, sans-serif' }}
    >
      {/* Background texture blobs */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-120px', left: '-120px',
          width: '500px', height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(26,92,58,0.18) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: '-100px', right: '-100px',
          width: '400px', height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(26,92,58,0.12) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      <div className="relative w-full max-w-md px-4 py-8">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div
            style={{
              width: 36, height: 36,
              background: '#1a5c3a',
              borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="#f7f4ef"/>
            </svg>
          </div>
          <span style={{ color: '#f7f4ef', fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>
            MeetScribe
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'rgba(247,244,239,0.04)',
            border: '1px solid rgba(247,244,239,0.1)',
            borderRadius: 20,
            padding: '36px 32px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          }}
        >
          {/* Heading */}
          <div className="text-center mb-6">
            <h1 style={{ color: '#f7f4ef', fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', margin: 0 }}>
              {mode === 'signup' && 'Create account'}
              {mode === 'otp' && (otpSent ? 'Enter your code' : 'Welcome back')}
            </h1>
            <p style={{ color: '#7a7a7a', fontSize: 13, marginTop: 6 }}>
              {mode === 'signup' && 'Start capturing meeting intelligence'}
              {mode === 'otp' && (otpSent ? `Code sent to ${email}` : 'We\'ll email you a 6-digit code')}
            </p>
          </div>

          {/* Tabs */}
          <div
            className="flex gap-1 p-1 mb-6"
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(247,244,239,0.06)',
              borderRadius: 10,
            }}
          >
            <button id="tab-signin" onClick={() => { setMode('otp'); setMessage(null); setOtpSent(false) }} className={tabClass(mode === 'otp')}>
              Sign In
            </button>
            <button id="tab-signup" onClick={() => { setMode('signup'); setMessage(null); setOtpSent(false) }} className={tabClass(mode === 'signup')}>
              Sign Up
            </button>
          </div>

          {/* Message Banner */}
          {message && (
            <div
              className="mb-5 rounded-xl px-4 py-3 text-sm"
              style={{
                background: message.type === 'success' ? 'rgba(26,92,58,0.12)' : 'rgba(200,75,31,0.12)',
                border: `1px solid ${message.type === 'success' ? 'rgba(26,92,58,0.3)' : 'rgba(200,75,31,0.3)'}`,
                color: message.type === 'success' ? '#2d7a50' : '#c84b1f',
              }}
            >
              {message.text}
            </div>
          )}


          {/* ── Sign Up Form ──────────────────────────────── */}
          {mode === 'signup' && (
            <form onSubmit={handleSignUp} className="space-y-4">
              <InputField id="signup-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <InputField id="signup-password" label="Password" type="password" value={password} onChange={setPassword} placeholder="Min 6 characters" minLength={6} />
              <SubmitButton loading={loading} label="Create Account" />
            </form>
          )}

          {/* ── OTP (Code) Login ──────────────────────────── */}
          {mode === 'otp' && !otpSent && (
            <div className="space-y-4">
              <InputField id="otp-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <button
                id="send-otp-btn"
                onClick={handleSendOtp}
                disabled={loading}
                style={{
                  width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                  background: loading ? '#2d7a50' : 'linear-gradient(135deg, #1a5c3a 0%, #2d7a50 100%)',
                  color: '#f7f4ef', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'opacity 0.2s', opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Sending...' : 'Send 6-Digit Code'}
              </button>
            </div>
          )}

          {mode === 'otp' && otpSent && (
            <div className="space-y-4">
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7a7a7a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  6-Digit Code
                </label>
                <input
                  id="otp-input"
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  style={{
                    width: '100%', padding: '14px', borderRadius: 10, border: '1px solid rgba(247,244,239,0.12)',
                    background: 'rgba(0,0,0,0.3)', color: '#f7f4ef', fontSize: 24, fontWeight: 700,
                    textAlign: 'center', letterSpacing: '0.25em', fontFamily: 'monospace',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  id="resend-otp-btn"
                  onClick={() => { setOtpSent(false); setOtp(''); setMessage(null) }}
                  style={{
                    flex: '0 0 auto', padding: '12px 16px', borderRadius: 10,
                    border: '1px solid rgba(247,244,239,0.12)',
                    background: 'transparent', color: '#7a7a7a', fontSize: 13,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Resend
                </button>
                <button
                  id="verify-otp-btn"
                  onClick={handleVerifyOtp}
                  disabled={loading}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(135deg, #1a5c3a 0%, #2d7a50 100%)',
                    color: '#f7f4ef', fontWeight: 700, fontSize: 14,
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? 'Verifying...' : 'Verify & Sign In →'}
                </button>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="relative flex items-center my-6">
            <div style={{ flex: 1, height: 1, background: 'rgba(247,244,239,0.08)' }} />
            <span style={{ padding: '0 12px', fontSize: 11, color: '#7a7a7a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              or
            </span>
            <div style={{ flex: 1, height: 1, background: 'rgba(247,244,239,0.08)' }} />
          </div>

          {/* Google */}
          <button
            id="google-login-btn"
            onClick={handleGoogle}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '12px', borderRadius: 10,
              border: '1px solid rgba(247,244,239,0.12)',
              background: 'rgba(247,244,239,0.04)',
              color: '#f7f4ef', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(247,244,239,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(247,244,239,0.04)')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>

        <p style={{ textAlign: 'center', color: '#7a7a7a', fontSize: 12, marginTop: 20 }}>
          By continuing, you agree to MeetScribe's Terms of Service.
        </p>
      </div>
    </div>
  )
}

// ─── Helper sub-components ─────────────────────────────────────────────────────

function InputField({
  id, label, type, value, onChange, placeholder, minLength,
}: {
  id: string; label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder: string; minLength?: number
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7a7a7a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        minLength={minLength}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          border: '1px solid rgba(247,244,239,0.12)',
          background: 'rgba(0,0,0,0.3)', color: '#f7f4ef', fontSize: 14,
          outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s',
        }}
        onFocus={(e) => (e.target.style.borderColor = '#1a5c3a')}
        onBlur={(e) => (e.target.style.borderColor = 'rgba(247,244,239,0.12)')}
      />
    </div>
  )
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        width: '100%', padding: '13px', borderRadius: 10, border: 'none',
        background: loading ? '#2d7a50' : 'linear-gradient(135deg, #1a5c3a 0%, #2d7a50 100%)',
        color: '#f7f4ef', fontWeight: 700, fontSize: 14,
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s',
        boxShadow: '0 4px 20px rgba(26,92,58,0.35)',
        marginTop: 4,
      }}
    >
      {loading ? 'Please wait...' : label}
    </button>
  )
}
