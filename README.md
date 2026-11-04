# TravelChat

A chat-based travel app where users search for flights, book tickets, and manage seats through conversation with Claude.

Built as a learning project to understand core AI engineering concepts: MCP servers, LLM tool calling, streaming, hooks, skills as `.md` files, and CLAUDE.md layering.

## What it does

- **Search flights** — ask in natural language, Claude calls the search tool automatically
- **Book tickets** — Claude handles the booking flow through conversation
- **Change seats** — update your seat on any existing booking
- **Cancel bookings** — cancel from the My Bookings page
- **Guest mode** — chat without signing in; email OTP required before booking
- **Authenticated mode** — sign in with GitHub, Google, or email/password to save and resume conversations

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 App Router |
| AI | Vercel AI SDK v7 |
| Model | Claude Haiku (`claude-haiku-4-5-20251001`) |
| MCP | `@modelcontextprotocol/sdk` (InMemoryTransport) |
| Auth | NextAuth v5 — GitHub OAuth, Google OAuth, Credentials |
| Database | Neon Postgres |
| ORM | Drizzle ORM |
| Email | Nodemailer + Gmail |
| Styling | Tailwind CSS |
| Testing | Vitest (29 tests across 3 layers) |

## Key concepts demonstrated

- **MCP server** (`mcp-server/`) — custom server exposing travel tools; connected in-process via `InMemoryTransport` (no subprocess)
- **Tool calling** — Claude decides when to call `search_flights`, `book_flight`, etc. based on the conversation
- **Streaming** — responses stream token by token via `streamText` + `toUIMessageStreamResponse`
- **Hooks** — `onStepFinish` logs every tool call + saves bookings, `onFinish` saves the response to DB
- **Skills as `.md` files** — `skills/` folder loaded into the system prompt; Anthropic prompt caching keeps token cost low
- **Global API handler** — `lib/api-handler.ts` wraps every route; consistent error format, centralised logging
- **LLM observability** — `@langfuse/vercel-ai-sdk` + `@langfuse/otel` (Langfuse v5 stack); `registerTelemetry()` hooks into AI SDK v7's callback system, `LangfuseSpanProcessor` exports OTel spans to Langfuse — captures tool traces, token costs, latency per conversation
- **JSONB message storage** — full `UIMessage` objects stored in Postgres so tool call history survives refresh
- **Adapter pattern** — swap mock flight data for a real API via `FLIGHT_PROVIDER` env var, zero code changes

## Project structure

```
travel-chat-app/
├── CLAUDE.md                        # Architecture rules for Claude
├── mcp-server/
│   ├── CLAUDE.md                    # MCP-specific rules
│   └── index.ts                     # search_flights, get_flight_seats, book_flight, get_booking, change_seat
├── skills/
│   ├── flight-search.md             # Rules: when to call search, date validation
│   ├── booking.md                   # Rules: confirmation flow, guest OTP gate
│   └── seat-management.md           # Rules: seat maps, guest OTP for changes
├── lib/
│   ├── api-handler.ts               # Global error handler HOF + AppError class
│   ├── auth.ts                      # NextAuth config (GitHub + Google + Credentials)
│   ├── email.ts                     # Nodemailer helpers (booking confirm, OTP, reset)
│   ├── password.ts                  # Shared password validation rules
│   ├── rate-limit.ts                # Sliding-window rate limiter (20 req/min per IP)
│   ├── tools.ts                     # Session-aware direct tools (book, change_seat, OTP)
│   ├── mcp-bridge.ts                # Connects MCP server in-process
│   ├── ai-hooks.ts                  # Logging hook for tool calls
│   ├── langfuse-processor.ts        # Singleton LangfuseSpanProcessor (shared by instrumentation + chat route)
│   ├── db/
│   │   ├── schema.ts                # Drizzle table definitions
│   │   ├── queries.ts               # Typed DB helpers
│   │   └── index.ts                 # Drizzle client
│   └── flight-provider/             # FlightProvider interface + mock implementation
├── app/
│   ├── global-error.tsx             # React error boundary (whole-app crash fallback)
│   ├── page.tsx                     # Landing page
│   ├── login/page.tsx               # GitHub / Google / email+password sign in
│   ├── register/page.tsx            # Email+password registration
│   ├── forgot-password/page.tsx     # Request password reset email
│   ├── reset-password/page.tsx      # Set new password from reset link
│   ├── api/
│   │   ├── chat/route.ts            # Main AI streaming route
│   │   └── conversations/           # CRUD for saved conversations
│   ├── chat/
│   │   ├── [id]/page.tsx            # Authenticated conversation
│   │   ├── guest/page.tsx           # Guest mode
│   │   └── bookings/                # My Bookings page + cancel server action
│   └── components/
└── tests/
    ├── layer1-tool-logic/           # Unit tests — provider logic, password validation (20 tests)
    ├── layer2-mcp-contract/         # MCP contract tests — tool schemas, guest vs auth tools (7 tests)
    └── layer3-llm/                  # LLM integration tests — Claude calls the right tool (2 tests, needs API key)
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in:
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `DATABASE_URL` — Neon Postgres connection string from [neon.tech](https://neon.tech)
- `NEXTAUTH_SECRET` — run `openssl rand -base64 32`
- `NEXTAUTH_URL` — `http://localhost:3002` in development
- `GITHUB_ID` + `GITHUB_SECRET` — GitHub OAuth app, callback: `http://localhost:3002/api/auth/callback/github`
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google OAuth app, callback: `http://localhost:3002/api/auth/callback/google`
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` — Gmail account for sending OTP and booking confirmation emails
- `LANGFUSE_SECRET_KEY` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_BASEURL` — from [cloud.langfuse.com](https://cloud.langfuse.com) (free tier); US region: `https://us.cloud.langfuse.com`

### 3. Push the database schema

```bash
npx drizzle-kit push
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3002](http://localhost:3002).

### 5. Run tests

```bash
npx vitest run
```

Layer 3 (LLM) tests run automatically when `ANTHROPIC_API_KEY` is set; they skip gracefully otherwise.

## How it works

**Guest mode** (`/chat/guest`) — messages live in React state only. Refresh = start over. Email OTP verification required before booking to prove inbox ownership.

**Authenticated mode** (`/chat/[id]`) — each message is saved to Postgres as a full `UIMessage` JSONB object. On page load, messages are fetched from the DB and restored into the chat. This preserves tool call history so conversations truly resume.

**MCP tools** — the MCP server runs in-process via `InMemoryTransport` (no subprocess, no stdio). Claude automatically decides which tool to call based on the conversation.

## Flight data

Uses mock data by default (`FLIGHT_PROVIDER=mock`). Available routes: JFK↔LAX, JFK↔ORD, JFK↔MIA, SFO↔JFK.

To swap in a real API, set `FLIGHT_PROVIDER=amadeus` and implement `lib/flight-provider/amadeus-provider.ts`.
