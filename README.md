# MeetScribe — AI Meeting Bot

MeetScribe is a self-hosted AI meeting assistant that joins your Google Meet calls, transcribes speech in real time, and generates a per-speaker AI summary with action items when the meeting ends.

---

## Features

- Joins Google Meet automatically via a Playwright-controlled browser bot
- Real-time live transcript streamed to the dashboard via WebSocket
- AI-generated summary: per-speaker breakdown, decisions, and action items
- Supabase authentication (email OTP login)
- Full Docker Compose setup — one command to run everything

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Next.js   │────▶│   NestJS API     │────▶│   PostgreSQL    │
│   Web App   │     │   (port 3000)    │     │   (Supabase)    │
│  (port 4000)│     └──────────────────┘     └─────────────────┘
└──────┬──────┘              │
       │                     │ Kafka
       │              ┌──────▼──────────┐
       │ WebSocket    │ Bot Orchestrator │──── spawns ────▶ Bot Worker
       └─────────────▶│ (port 3001)     │                  (Playwright)
                      └──────┬──────────┘
                             │
                    ┌────────▼────────┐     ┌─────────────────┐
                    │ Audio Processor │────▶│   Deepgram STT  │
                    │   (port 8001)   │     └─────────────────┘
                    └────────┬────────┘
                             │ Kafka
                    ┌────────▼────────┐
                    │  AI Summarizer  │──── Groq / Gemini / Claude
                    └─────────────────┘
```

**Services:**
| Service | Description |
|---|---|
| `web` | Next.js 16 frontend dashboard |
| `api` | NestJS REST API + Supabase auth |
| `websocket-server` | Real-time transcript streaming |
| `bot-orchestrator` | Manages bot lifecycle via Kafka |
| `bot-worker` | Playwright browser bot that joins meetings |
| `audio-processor` | Captures audio and sends to Deepgram STT |
| `ai-summarizer` | Generates meeting summaries using LLMs |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- A [Supabase](https://supabase.com) project (free tier is enough)
- At least one AI API key — Groq (free), Gemini (free), or Anthropic

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/RiteshShingre2004/Meeting-Bot.git
cd Meeting-Bot
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values. Required fields:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string |
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com) |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) (free) |

### 3. Run database migrations

```bash
docker compose run --rm api npx prisma migrate deploy
```

### 4. Start everything

```bash
docker compose up --build
```

First build takes 5–10 minutes. After that, open [http://localhost:4000](http://localhost:4000).

---

## Usage

1. Sign in at [http://localhost:4000](http://localhost:4000)
2. Click **Schedule Meeting** and paste a Google Meet link
3. The bot joins the call, transcribes speech live, and generates a summary when the meeting ends
4. View the live transcript and AI summary in the dashboard

---

## Environment Variables Reference

See [`.env.example`](.env.example) for the full list with descriptions.

---

## Tech Stack

- **Frontend:** Next.js 16, Tailwind CSS, Framer Motion
- **Backend:** NestJS, Prisma, PostgreSQL (Supabase)
- **Realtime:** Socket.IO, Kafka, Redis
- **Bot:** Playwright (Chromium)
- **STT:** Deepgram
- **AI:** Groq (Llama 3), Google Gemini, Anthropic Claude (configurable)
- **Auth:** Supabase Auth

---

## Project Structure

```
apps/
  web/              # Next.js frontend
  api/              # NestJS REST API
  websocket-server/ # Socket.IO server
  bot-orchestrator/ # Bot lifecycle manager
  bot-worker/       # Playwright browser bot
  audio-processor/  # Audio capture + Deepgram STT
  ai-summarizer/    # LLM summary generation
packages/
  database/         # Prisma schema + migrations
```
# MeetScribe-
