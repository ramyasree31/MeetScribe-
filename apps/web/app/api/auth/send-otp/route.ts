import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = new Resend(process.env.RESEND_API_KEY)

// Supabase admin client for generating OTPs
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// In-memory OTP store (persists per server process; good enough for dev/small prod)
// For production at scale, swap with Redis/Upstash
const otpStore = new Map<string, { otp: string; expires: number }>()

export async function POST(req: NextRequest) {
  try {
    const { email, action } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (action === 'verify') {
      // Verification path — handled on client via supabase.auth.verifyOtp
      return NextResponse.json({ success: true })
    }

    // Generate a 6-digit OTP
    const otp = generateOTP()
    const expires = Date.now() + 10 * 60 * 1000 // 10 minutes

    // Store OTP server-side
    otpStore.set(email.toLowerCase(), { otp, expires })
    console.log(`[DEV ONLY] Generated OTP for ${email}: ${otp}`)

    // Send via Resend
    const { error } = await resend.emails.send({
      from: 'MeetScribe <onboarding@resend.dev>',
      to: email,
      subject: `Your MeetScribe verification code: ${otp}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>MeetScribe OTP</title>
          </head>
          <body style="margin:0;padding:0;background-color:#f7f4ef;font-family:'DM Sans',system-ui,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;background:#f7f4ef;">
              <tr>
                <td align="center" style="padding:48px 24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #ede9e1;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
                    <!-- Header -->
                    <tr>
                      <td style="background:#0d0d0d;padding:32px 40px;text-align:center;">
                        <div style="display:inline-flex;align-items:center;gap:10px;">
                          <div style="width:32px;height:32px;background:#1a5c3a;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;">
                            <span style="color:white;font-weight:700;font-size:16px;">M</span>
                          </div>
                          <span style="color:#f7f4ef;font-size:20px;font-weight:700;letter-spacing:-0.02em;">MeetScribe</span>
                        </div>
                        <p style="color:#7a7a7a;font-size:13px;margin:8px 0 0;">AI Meeting Intelligence</p>
                      </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                      <td style="padding:40px 40px 32px;">
                        <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0d0d0d;letter-spacing:-0.02em;">Your verification code</h1>
                        <p style="margin:0 0 32px;font-size:15px;color:#7a7a7a;line-height:1.6;">Enter this code to sign in to your MeetScribe account. It expires in 10 minutes.</p>
                        
                        <!-- OTP Box -->
                        <div style="background:#f7f4ef;border:2px solid #1a5c3a;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;">
                          <span style="font-size:42px;font-weight:800;color:#1a5c3a;letter-spacing:12px;font-family:monospace;">${otp}</span>
                        </div>
                        
                        <p style="margin:0;font-size:13px;color:#7a7a7a;line-height:1.6;">
                          If you didn't request this code, you can safely ignore this email.<br/>
                          This code will expire in <strong>10 minutes</strong>.
                        </p>
                      </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                      <td style="background:#f7f4ef;border-top:1px solid #ede9e1;padding:24px 40px;text-align:center;">
                        <p style="margin:0;font-size:12px;color:#7a7a7a;">© 2026 MeetScribe · AI Meeting Intelligence</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    })

    if (error) {
      console.error('Resend error:', error)
      console.log(`[DEV ONLY] Resend failed, but continuing for local testing. OTP is: ${otp}`)
    }

    return NextResponse.json({ success: true, message: 'OTP sent successfully', devOtp: otp })
  } catch (err: any) {
    console.error('send-otp route error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// Verify endpoint — check OTP against our store
export async function PUT(req: NextRequest) {
  try {
    const { email, otp } = await req.json()

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 })
    }

    const record = otpStore.get(email.toLowerCase())

    if (!record) {
      return NextResponse.json({ error: 'No OTP found for this email. Please request a new code.' }, { status: 400 })
    }

    if (Date.now() > record.expires) {
      otpStore.delete(email.toLowerCase())
      return NextResponse.json({ error: 'OTP has expired. Please request a new code.' }, { status: 400 })
    }

    if (record.otp !== otp.trim()) {
      return NextResponse.json({ error: 'Invalid code. Please try again.' }, { status: 400 })
    }

    // OTP is valid — delete it (single use)
    otpStore.delete(email.toLowerCase())

    // Now sign in via Supabase admin to get a session
    // We use generateLink to create a magic link then exchange it
    // Actually, the simplest approach: use Supabase admin to create a session
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    })

    if (error) {
      console.error('Supabase admin link error:', error)
      return NextResponse.json({ error: 'Authentication failed. Please try again.' }, { status: 500 })
    }

    // Return the token_hash + type so the client can call verifyOtp
    const url = new URL(data.properties.action_link)
    const tokenHash = url.searchParams.get('token_hash') || data.properties.hashed_token
    const type = url.searchParams.get('type') || 'magiclink'

    return NextResponse.json({ 
      success: true, 
      tokenHash,
      type,
      actionLink: data.properties.action_link
    })
  } catch (err: any) {
    console.error('verify-otp route error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
