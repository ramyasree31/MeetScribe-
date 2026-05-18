import React from "react";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="bg-cream text-ink font-sans min-h-screen overflow-x-hidden selection:bg-accent-light selection:text-accent">
      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-[100] px-6 md:px-10 py-4 flex items-center justify-between bg-cream/90 backdrop-blur-md border-b border-accent/10">
        <Link href="/" className="font-serif text-xl text-ink no-underline flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent inline-block"></span>
          MeetScribe
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#how" className="text-sm text-ink2 no-underline font-normal hover:text-accent transition-colors duration-200">How it works</a>
          <a href="#features" className="text-sm text-ink2 no-underline font-normal hover:text-accent transition-colors duration-200">Features</a>
          <a href="#pricing" className="text-sm text-ink2 no-underline font-normal hover:text-accent transition-colors duration-200">Pricing</a>
          <Link href="/login" className="bg-ink text-cream border-none rounded-full px-5 py-2 font-sans text-sm font-medium cursor-pointer no-underline hover:bg-accent transition-all duration-200 hover:-translate-y-px">
            Start free
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="min-h-screen flex flex-col items-center justify-center pt-32 pb-20 px-4 text-center relative">
        <div className="inline-flex items-center gap-2 bg-accent-light text-accent border border-accent/20 rounded-full px-4 py-1.5 text-[13px] font-medium mb-8 animate-[fadeUp_0.6s_ease_both]">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-[pulse_2s_infinite]"></span> Live in every meeting
        </div>
        <h1 className="font-serif text-[clamp(3rem,7vw,5.5rem)] font-normal leading-[1.08] text-ink max-w-[820px] animate-[fadeUp_0.7s_0.1s_ease_both]">
          Your AI that <em className="text-accent not-italic">listens,</em><br />so your team doesn&apos;t have to
        </h1>
        <p className="mt-6 text-lg text-ink2 max-w-[520px] leading-relaxed font-light animate-[fadeUp_0.7s_0.2s_ease_both]">
          MeetScribe joins your Google Meet, Zoom, and Teams calls, transcribes in real time, and delivers structured notes and action items the moment the call ends.
        </p>
        <div className="mt-10 flex gap-4 items-center justify-center flex-wrap animate-[fadeUp_0.7s_0.3s_ease_both]">
          <Link href="/login" className="bg-accent text-white border-none rounded-full px-9 py-3.5 font-sans text-[15px] font-medium cursor-pointer no-underline transition-all duration-200 hover:bg-accent2 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(26,92,58,0.3)] shadow-[0_4px_20px_rgba(26,92,58,0.25)]">
            Get started free &rarr;
          </Link>
          <a href="#how" className="bg-transparent text-ink2 border border-cream2 rounded-full px-8 py-3.5 font-sans text-[15px] font-normal cursor-pointer no-underline transition-colors duration-200 hover:border-ink2 hover:text-ink">
            See how it works
          </a>
        </div>
        <p className="mt-4 text-[12.5px] text-ink3 animate-[fadeUp_0.7s_0.4s_ease_both]">
          No credit card &middot; Free for 5 meetings/month &middot; Cancel anytime
        </p>

        {/* HERO VISUAL */}
        <div className="mt-16 w-full max-w-[900px] animate-[fadeUp_0.8s_0.4s_ease_both] relative text-left">
          <div className="bg-white rounded-2xl border border-black/5 shadow-[0_40px_80px_rgba(0,0,0,0.1),_0_8px_20px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="bg-[#f2f2f2] px-4 py-2.5 flex items-center gap-1.5 border-b border-[#e8e8e8]">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]"></div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[320px]">
              {/* Transcript Panel */}
              <div className="bg-cream rounded-xl p-5 border border-cream2">
                <div className="inline-flex items-center gap-1.5 bg-[#fdeee8] text-warn text-[11px] font-medium px-2.5 py-1 rounded-full mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-warn animate-[pulse_1.4s_infinite]"></span>
                  Live transcript
                </div>
                <div className="flex gap-2 mb-2 items-start opacity-0 animate-[lineIn_0.4s_ease_forwards]" style={{ animationDelay: "0.8s" }}>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 bg-accent-light text-accent">Asha</span>
                  <span className="text-[13px] text-ink2 leading-relaxed">Let&apos;s align on the Q3 launch timeline before we loop in design.</span>
                </div>
                <div className="flex gap-2 mb-2 items-start opacity-0 animate-[lineIn_0.4s_ease_forwards]" style={{ animationDelay: "1.4s" }}>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 bg-[#fdeee8] text-[#b84020]">Rohan</span>
                  <span className="text-[13px] text-ink2 leading-relaxed">We&apos;re targeting July 14th for the soft launch, hard launch on the 21st.</span>
                </div>
                <div className="flex gap-2 mb-2 items-start opacity-0 animate-[lineIn_0.4s_ease_forwards]" style={{ animationDelay: "2.0s" }}>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 bg-[#eef3fd] text-[#3355aa]">Priya</span>
                  <span className="text-[13px] text-ink2 leading-relaxed">I&apos;ll own the design handoff by Friday &mdash; does that work for everyone?</span>
                </div>
                <div className="flex gap-2 mb-2 items-start opacity-0 animate-[lineIn_0.4s_ease_forwards]" style={{ animationDelay: "2.6s" }}>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5 bg-accent-light text-accent">Asha</span>
                  <span className="text-[13px] text-ink2 leading-relaxed">Perfect. Rohan, can you send the revised spec by EOD tomorrow?</span>
                </div>
              </div>
              
              {/* Summary Panel */}
              <div className="bg-cream rounded-xl p-5 border border-cream2">
                <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink3 mb-3">AI summary &middot; just generated</div>
                <div className="flex gap-2 mb-2.5 text-[13px] text-ink2">
                  <span className="text-accent mt-0.5 text-sm">📋</span>
                  <span>Soft launch July 14, hard launch July 21. Design handoff needed by Friday.</span>
                </div>
                <div className="flex gap-2 mb-2.5 text-[13px] text-ink2">
                  <span className="text-accent mt-0.5 text-sm">✅</span>
                  <div>
                    <div className="text-[12px] text-ink3 mb-1">Action items</div>
                    <span className="inline-block bg-accent-light text-accent text-[11px] font-medium px-2 py-1 rounded-full m-0.5">Priya &rarr; design handoff</span>
                    <span className="inline-block bg-accent-light text-accent text-[11px] font-medium px-2 py-1 rounded-full m-0.5">Rohan &rarr; revised spec EOD</span>
                  </div>
                </div>
                <div className="flex gap-2 mb-2.5 text-[13px] text-ink2">
                  <span className="text-accent mt-0.5 text-sm">👥</span>
                  <div>
                    <div className="text-[12px] text-ink3 mb-1">Participants</div>
                    <span className="inline-block bg-accent-light text-accent text-[11px] font-medium px-2 py-1 rounded-full m-0.5">Asha &middot; PM</span>
                    <span className="inline-block bg-accent-light text-accent text-[11px] font-medium px-2 py-1 rounded-full m-0.5">Rohan &middot; Eng</span>
                    <span className="inline-block bg-accent-light text-accent text-[11px] font-medium px-2 py-1 rounded-full m-0.5">Priya &middot; Design</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PLATFORM STRIP */}
      <div className="py-8 px-10 flex items-center justify-center gap-3 border-y border-cream2 bg-cream flex-wrap">
        <span className="text-xs text-ink3 mr-4">Works with</span>
        <div className="flex items-center gap-1.5 bg-white border border-cream2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink2"><span className="w-4.5 h-4.5 rounded text-[12px] flex items-center justify-center bg-[#e8f0fe]">📹</span>Google Meet</div>
        <div className="flex items-center gap-1.5 bg-white border border-cream2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink2"><span className="w-4.5 h-4.5 rounded text-[12px] flex items-center justify-center bg-[#e8f0fe]">💻</span>Zoom</div>
        <div className="flex items-center gap-1.5 bg-white border border-cream2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink2"><span className="w-4.5 h-4.5 rounded text-[12px] flex items-center justify-center bg-[#e8f3ff]">🟦</span>Microsoft Teams</div>
        <div className="flex items-center gap-1.5 bg-white border border-cream2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink2"><span className="w-4.5 h-4.5 rounded text-[12px] flex items-center justify-center bg-[#fdf4e7]">📅</span>Google Calendar</div>
        <div className="flex items-center gap-1.5 bg-white border border-cream2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink2"><span className="w-4.5 h-4.5 rounded text-[12px] flex items-center justify-center bg-[#e8f4ed]">🔗</span>Outlook</div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how" className="py-24 px-6 md:px-8">
        <div className="max-w-[1060px] mx-auto">
          <div className="text-xs font-medium uppercase tracking-widest text-accent mb-3">How it works</div>
          <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] font-normal leading-[1.15] text-ink">From calendar to<br/><em className="text-accent not-italic">structured notes</em> in minutes</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mt-14">
            <div className="bg-white border border-cream2 rounded-2xl p-7 relative transition-all duration-200 hover:shadow-[0_12px_32px_rgba(0,0,0,0.07)] hover:-translate-y-1">
              <span className="font-serif italic text-4xl text-cream2 absolute top-4 right-5 leading-none">01</span>
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center text-xl mb-4">🔗</div>
              <h3 className="text-base font-medium mb-1.5">Connect your calendar</h3>
              <p className="text-sm text-ink3 leading-relaxed">Link Google Calendar or Outlook. MeetScribe reads your upcoming meetings &mdash; nothing more.</p>
            </div>
            <div className="bg-white border border-cream2 rounded-2xl p-7 relative transition-all duration-200 hover:shadow-[0_12px_32px_rgba(0,0,0,0.07)] hover:-translate-y-1">
              <span className="font-serif italic text-4xl text-cream2 absolute top-4 right-5 leading-none">02</span>
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center text-xl mb-4">🤖</div>
              <h3 className="text-base font-medium mb-1.5">Bot joins automatically</h3>
              <p className="text-sm text-ink3 leading-relaxed">2 minutes before each meeting, a bot silently joins your call. No installs, no plugins, no friction.</p>
            </div>
            <div className="bg-white border border-cream2 rounded-2xl p-7 relative transition-all duration-200 hover:shadow-[0_12px_32px_rgba(0,0,0,0.07)] hover:-translate-y-1">
              <span className="font-serif italic text-4xl text-cream2 absolute top-4 right-5 leading-none">03</span>
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center text-xl mb-4">📡</div>
              <h3 className="text-base font-medium mb-1.5">Real-time transcription</h3>
              <p className="text-sm text-ink3 leading-relaxed">Audio streams live to Deepgram. Speaker-labelled words appear in your dashboard as they&apos;re spoken.</p>
            </div>
            <div className="bg-white border border-cream2 rounded-2xl p-7 relative transition-all duration-200 hover:shadow-[0_12px_32px_rgba(0,0,0,0.07)] hover:-translate-y-1">
              <span className="font-serif italic text-4xl text-cream2 absolute top-4 right-5 leading-none">04</span>
              <div className="w-11 h-11 rounded-xl bg-accent-light flex items-center justify-center text-xl mb-4">✨</div>
              <h3 className="text-base font-medium mb-1.5">AI summary delivered</h3>
              <p className="text-sm text-ink3 leading-relaxed">The moment the call ends, Claude generates a structured note &mdash; overview, decisions, and owner-tagged action items.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-24 px-6 md:px-8 bg-white">
        <div className="max-w-[1060px] mx-auto">
          <div className="text-xs font-medium uppercase tracking-widest text-accent mb-3">Features</div>
          <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] font-normal leading-[1.15] text-ink">Everything a high-performing<br/>team <em className="text-accent not-italic">actually needs</em></h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 mt-14 border-t border-l border-cream2 rounded-2xl overflow-hidden">
            <div className="p-8 border-r border-b border-cream2 transition-colors duration-200 hover:bg-cream">
              <div className="text-2xl mb-4">🎙️</div>
              <h3 className="text-[15px] font-medium mb-1.5">Speaker diarisation</h3>
              <p className="text-[13.5px] text-ink3 leading-relaxed">Deepgram Nova-2 separates voices automatically. Know exactly who said what, every time.</p>
            </div>
            <div className="p-8 border-r border-b border-cream2 transition-colors duration-200 hover:bg-cream">
              <div className="text-2xl mb-4">⚡</div>
              <h3 className="text-[15px] font-medium mb-1.5">Live transcript feed</h3>
              <p className="text-[13.5px] text-ink3 leading-relaxed">Watch the transcript appear word-by-word during the call. Share the link with absent teammates.</p>
            </div>
            <div className="p-8 border-r border-b border-cream2 transition-colors duration-200 hover:bg-cream">
              <div className="text-2xl mb-4">📝</div>
              <h3 className="text-[15px] font-medium mb-1.5">Structured AI notes</h3>
              <p className="text-[13.5px] text-ink3 leading-relaxed">Not a wall of text. Every summary has an overview, key decisions, and action items with owners.</p>
            </div>
            <div className="p-8 border-r border-b border-cream2 transition-colors duration-200 hover:bg-cream">
              <div className="text-2xl mb-4">✅</div>
              <h3 className="text-[15px] font-medium mb-1.5">Action item tracking</h3>
              <p className="text-[13.5px] text-ink3 leading-relaxed">Each action item has an owner and suggested due date. Export to Notion, Linear, or Jira instantly.</p>
            </div>
            <div className="p-8 border-r border-b border-cream2 transition-colors duration-200 hover:bg-cream">
              <div className="text-2xl mb-4">🔒</div>
              <h3 className="text-[15px] font-medium mb-1.5">Private by design</h3>
              <p className="text-[13.5px] text-ink3 leading-relaxed">Audio is processed ephemerally. We store transcripts, not recordings. SOC 2 in progress.</p>
            </div>
            <div className="p-8 border-r border-b border-cream2 transition-colors duration-200 hover:bg-cream">
              <div className="text-2xl mb-4">🌐</div>
              <h3 className="text-[15px] font-medium mb-1.5">Multi-platform bots</h3>
              <p className="text-[13.5px] text-ink3 leading-relaxed">Google Meet, Zoom (web), and Teams. Waiting room handling built in &mdash; bots get in, every time.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-24 px-6 md:px-8">
        <div className="max-w-[1060px] mx-auto">
          <div className="text-xs font-medium uppercase tracking-widest text-accent mb-3">What people say</div>
          <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] font-normal leading-[1.15] text-ink">Teams reclaim <em className="text-accent not-italic">hours</em><br/>every week</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-12">
            <div className="bg-white border border-cream2 rounded-2xl p-6">
              <div className="text-[#f59e0b] text-[13px] mb-3">★★★★★</div>
              <p className="text-sm text-ink2 leading-relaxed mb-4 italic">&quot;We stopped manually writing meeting notes entirely. MeetScribe&apos;s action items are more accurate than anything we produced ourselves.&quot;</p>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-accent-light text-accent text-[13px] font-medium flex items-center justify-center">SK</div>
                <div>
                  <div className="text-[13px] font-medium">Siddharth K.</div>
                  <div className="text-xs text-ink3">VP Product &middot; Razorpay</div>
                </div>
              </div>
            </div>
            <div className="bg-white border border-cream2 rounded-2xl p-6">
              <div className="text-[#f59e0b] text-[13px] mb-3">★★★★★</div>
              <p className="text-sm text-ink2 leading-relaxed mb-4 italic">&quot;The live transcript during calls changed how we do client demos. We share the link in chat and clients love seeing their words captured in real time.&quot;</p>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#fdeee8] text-[#b84020] text-[13px] font-medium flex items-center justify-center">NP</div>
                <div>
                  <div className="text-[13px] font-medium">Neha P.</div>
                  <div className="text-xs text-ink3">Founder &middot; Bengaluru SaaS Co</div>
                </div>
              </div>
            </div>
            <div className="bg-white border border-cream2 rounded-2xl p-6">
              <div className="text-[#f59e0b] text-[13px] mb-3">★★★★★</div>
              <p className="text-sm text-ink2 leading-relaxed mb-4 italic">&quot;Our PMs used to spend 30 mins writing notes after every sprint review. Now they get a structured doc 10 seconds after the call ends.&quot;</p>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#eef3fd] text-[#3355aa] text-[13px] font-medium flex items-center justify-center">AM</div>
                <div>
                  <div className="text-[13px] font-medium">Arnav M.</div>
                  <div className="text-xs text-ink3">Engineering Lead &middot; Series B startup</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-24 px-6 md:px-8 bg-white">
        <div className="max-w-[1060px] mx-auto">
          <div className="text-xs font-medium uppercase tracking-widest text-accent mb-3">Pricing</div>
          <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] font-normal leading-[1.15] text-ink">Simple pricing,<br/>no <em className="text-accent not-italic">surprises</em></h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            <div className="bg-white border border-cream2 rounded-2xl p-8 relative transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
              <div className="text-[13px] font-medium uppercase tracking-widest text-ink3 mb-2">Starter</div>
              <div className="font-serif text-5xl leading-none mb-1">$0</div>
              <div className="text-[13px] text-ink3">free forever</div>
              <div className="h-px bg-cream2 my-6"></div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> 5 meetings/month</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Live transcription</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> AI summary + action items</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Google Meet support</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink3">&mdash; Zoom & Teams</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink3">&mdash; Integrations</div>
              <Link href="/login" className="block w-full text-center mt-6 p-3 rounded-full font-sans text-sm font-medium cursor-pointer border border-cream2 bg-cream text-ink transition-all duration-200 hover:bg-accent hover:text-white hover:border-accent">
                Get started free
              </Link>
            </div>
            
            <div className="bg-ink border-ink text-white rounded-2xl p-8 relative transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-white text-[11px] font-medium px-3 py-1 rounded-full whitespace-nowrap">Most popular</div>
              <div className="text-[13px] font-medium uppercase tracking-widest text-white/50 mb-2">Pro</div>
              <div className="font-serif text-5xl leading-none mb-1">$19</div>
              <div className="text-[13px] text-white/50">per user / month</div>
              <div className="h-px bg-white/15 my-6"></div>
              <div className="flex gap-2 text-sm mb-2.5 text-white/85"><span className="text-[#6ed9a0] font-semibold">✓</span> Unlimited meetings</div>
              <div className="flex gap-2 text-sm mb-2.5 text-white/85"><span className="text-[#6ed9a0] font-semibold">✓</span> Live transcription</div>
              <div className="flex gap-2 text-sm mb-2.5 text-white/85"><span className="text-[#6ed9a0] font-semibold">✓</span> AI summary + action items</div>
              <div className="flex gap-2 text-sm mb-2.5 text-white/85"><span className="text-[#6ed9a0] font-semibold">✓</span> Google Meet, Zoom & Teams</div>
              <div className="flex gap-2 text-sm mb-2.5 text-white/85"><span className="text-[#6ed9a0] font-semibold">✓</span> Notion, Linear, Jira export</div>
              <div className="flex gap-2 text-sm mb-2.5 text-white/85"><span className="text-[#6ed9a0] font-semibold">✓</span> Shareable transcript links</div>
              <Link href="/login" className="block w-full text-center mt-6 p-3 rounded-full font-sans text-sm font-medium cursor-pointer border border-transparent bg-white text-ink transition-all duration-200 hover:bg-accent-light hover:text-ink">
                Start 14-day trial
              </Link>
            </div>

            <div className="bg-white border border-cream2 rounded-2xl p-8 relative transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
              <div className="text-[13px] font-medium uppercase tracking-widest text-ink3 mb-2">Team</div>
              <div className="font-serif text-5xl leading-none mb-1">$14</div>
              <div className="text-[13px] text-ink3">per user / month &middot; 5+ seats</div>
              <div className="h-px bg-cream2 my-6"></div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Everything in Pro</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Shared workspace</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Admin dashboard</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Priority support</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> SSO (Google Workspace)</div>
              <div className="flex gap-2 text-sm mb-2.5 text-ink2"><span className="text-accent font-semibold">✓</span> Custom integrations</div>
              <button className="block w-full text-center mt-6 p-3 rounded-full font-sans text-sm font-medium cursor-pointer border border-cream2 bg-cream text-ink transition-all duration-200 hover:bg-accent hover:text-white hover:border-accent">
                Talk to sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="bg-ink text-white text-center py-24 px-6 md:px-8">
        <h2 className="font-serif text-[clamp(2rem,4vw,3rem)] font-normal leading-[1.15] text-white max-w-[600px] mx-auto mb-4">Stop taking notes.<br/><em className="text-accent not-italic">Start making decisions.</em></h2>
        <p className="text-white/60 max-w-[440px] mx-auto mb-10 text-[15px]">Join teams who&apos;ve reclaimed hundreds of hours with MeetScribe. Your first 5 meetings are on us.</p>
        <Link href="/login" className="inline-block bg-accent text-white border-none rounded-full px-10 py-4 font-sans text-[15px] font-medium cursor-pointer no-underline transition-all duration-200 hover:bg-accent2 hover:-translate-y-0.5 shadow-[0_4px_20px_rgba(26,92,58,0.25)]">
          Get started free &rarr;
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="bg-ink text-white/40 py-10 px-10 flex items-center justify-between border-t border-white/5 flex-wrap gap-4">
        <span className="font-serif text-[1.1rem] text-white/80">MeetScribe</span>
        <div className="flex gap-6 flex-wrap">
          <a href="#" className="text-white/40 no-underline text-[13px] transition-colors duration-200 hover:text-white">Privacy</a>
          <a href="#" className="text-white/40 no-underline text-[13px] transition-colors duration-200 hover:text-white">Terms</a>
          <a href="#" className="text-white/40 no-underline text-[13px] transition-colors duration-200 hover:text-white">Security</a>
          <a href="#" className="text-white/40 no-underline text-[13px] transition-colors duration-200 hover:text-white">Docs</a>
          <a href="#" className="text-white/40 no-underline text-[13px] transition-colors duration-200 hover:text-white">Status</a>
        </div>
        <span className="text-[13px]">&copy; 2025 MeetScribe, Inc.</span>
      </footer>
    </div>
  );
}
