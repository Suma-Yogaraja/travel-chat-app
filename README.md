# TravelChat

[![CI](https://github.com/Suma-Yogaraja/travel-chat-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Suma-Yogaraja/travel-chat-app/actions/workflows/ci.yml)

**Live demo → [travel-chat-app-wine.vercel.app](https://travel-chat-app-wine.vercel.app)**

A chat-based travel app where users search for flights, book tickets, and manage seats through conversation with an AI assistant.

Built as a learning project to understand core AI engineering concepts: MCP servers, LLM tool calling, streaming, hooks, skills as `.md` files, real flight APIs, and Stripe payments.

## What it does

- **Search flights** — ask in natural language, the AI calls the search tool automatically
- **View seat maps** — interactive seat picker rendered directly in the chat
- **Book tickets (guests)** — email OTP verification before booking to prove inbox ownership
- **Pay for flights (authenticated)** — Stripe Checkout flow; webhook confirms payment before booking is saved
- **Change seats** — update your seat on any existing booking
- **Cancel bookings** — cancel from the My Bookings page
- **Guest mode** — chat without signing in; bookings saved with a GS- reference
- **Authenticated mode** — sign in with GitHub, Google, or email/password to save and resume conversations

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 App Router |
| AI | Vercel AI SDK v7 |
| Model | Groq `llama-3.3-70b-versatile` (swap to Claude Haiku in `app/api/chat/route.ts`) |
| MCP | `@modelcontextprotocol/sdk` (InMemoryTransport) |
| Auth | NextAuth v5 — GitHub OAuth, Google OAuth, Credentials |
| Database | Neon Postgres |
| ORM | Drizzle ORM |
| Flight data | Duffel API (sandbox) — fallback to mock via `FLIGHT_PROVIDER=mock` |
| Payments | Stripe Checkout (hosted page) + webhooks |
| Email | Nodemailer + Gmail |
| Observability | Langfuse (`@langfuse/vercel-ai-sdk` + `@langfuse/otel`) |
| Styling | Tailwind CSS v4 |
| Testing | Vitest (27 tests across 3 layers) |

## Architecture

```mermaid
graph LR
    U([Browser]) -->|chat + SSE stream| R[app/api/chat\nVercel AI SDK v7]
    R -->|tool calls| M[MCP Server\nsearch_flights\nget_flight_seats]
    R -->|tool calls| T[lib/tools.ts\ncreate_checkout\nget_booking\nchange_seat]
    M --> D[Duffel API\nReal flight data]
    T --> S[Stripe Checkout\n+ Webhooks]
    T --> DB[(Neon Postgres\nDrizzle ORM)]
    S -->|confirmed| DB
    R --> L[Langfuse\nOTel traces]
```

## Example conversation (authenticated user)

> **You:** Find me flights from London to New York next Friday
>
> *[AI calls `search_flights` → flight cards appear]*
>
> **You:** I'll take the second one. Show me the seats.
>
> *[AI calls `get_flight_seats` → seat map appears]*
>
> **You:** Book seat 12A for Sarah Connor
>
> **Assistant:** Just to confirm — Flight LHR→JFK, seat 12A, Sarah Connor, $412. Shall I proceed?
>
> **You:** Yes
>
> *[AI calls `create_checkout` → Pay button appears in chat]*
>
> **Assistant:** Click Pay to complete your booking securely via Stripe. Your reference is BK-1234567890-ab.
>
> *[User clicks Pay → Stripe checkout → test card → redirected to /booking/success → confirmed]*

## Key concepts demonstrated

- **MCP server** (`mcp-server/`) — custom server exposing travel tools; connected in-process via `InMemoryTransport` (no subprocess)
- **Tool calling** — AI decides when to call `search_flights`, `create_checkout`, etc. based on the conversation
- **Role-based tools** — guests get OTP + booking tools; authenticated users get `create_checkout`, `get_booking`, `change_seat`
- **Streaming** — responses stream token by token via `streamText` + `toUIMessageStreamResponse`
- **Skills as `.md` files** — `skills/` folder loaded into the system prompt; rules for search, booking, and seat management
- **Adapter pattern** — swap mock flight data for Duffel (or any real API) via `FLIGHT_PROVIDER` env var, zero code changes
- **Stripe webhooks as source of truth** — booking is only confirmed when the `checkout.session.completed` webhook fires, never on browser redirect
- **Circuit breaker** — `lib/stripe.ts` opens after 3 consecutive Stripe failures, auto-recovers after 60s
- **Fallback seat map** — when Duffel returns no seatmap (sandbox limitation), a deterministic layout is generated from the flight ID
- **Global API handler** — `lib/api-handler.ts` wraps every route; consistent error format, centralised logging
- **LLM observability** — Langfuse v5 stack captures tool traces, token costs, and latency per conversation
- **JSONB message storage** — full `UIMessage` objects stored in Postgres so tool call history survives refresh

## Project structure

```
travel-chat-app/
├── CLAUDE.md                        # Architecture rules for Claude Code
├── mcp-server/
│   ├── CLAUDE.md                    # MCP-specific rules
│   └── index.ts                     # search_flights, get_flight_seats (+ fallback seat map)
├── skills/
│   ├── flight-search.md             # Rules: when to call search, date validation
│   ├── booking.md                   # Rules: Stripe flow (auth), OTP flow (guest)
│   └── seat-management.md           # Rules: seat maps, guest OTP for changes
├── lib/
│   ├── api-handler.ts               # Global error handler HOF + AppError class
│   ├── auth.ts                      # NextAuth config (GitHub + Google + Credentials)
│   ├── email.ts                     # Nodemailer helpers (booking confirm, OTP, reset)
│   ├── stripe.ts                    # Stripe client singleton + circuit breaker + live key guard
│   ├── rate-limit.ts                # Sliding-window rate limiter (20 req/min per IP)
│   ├── tools.ts                     # Session-aware tools: create_checkout (auth), book_flight + OTP (guest)
│   ├── mcp-bridge.ts                # Connects MCP server in-process
│   ├── langfuse-processor.ts        # Singleton LangfuseSpanProcessor
│   ├── db/
│   │   ├── schema.ts                # Drizzle table definitions
│   │   ├── queries.ts               # Typed DB helpers
│   │   └── index.ts                 # Drizzle client
│   └── flight-provider/
│       ├── index.ts                 # FlightProvider interface + factory
│       ├── duffel-provider.ts       # Duffel API implementation (active)
│       └── mock-provider.ts         # Hardcoded mock data (fallback)
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # Main AI streaming route
│   │   └── stripe/
│   │       ├── webhook/route.ts     # Stripe webhook — confirms/expires bookings
│   │       └── status/route.ts      # Polling endpoint for success page
│   ├── booking/
│   │   └── success/page.tsx         # Payment confirmation page (polls status)
│   ├── chat/
│   │   ├── [id]/page.tsx            # Authenticated conversation
│   │   ├── guest/page.tsx           # Guest mode
│   │   └── bookings/                # My Bookings page
│   ├── login/ register/ forgot-password/ reset-password/
│   └── global-error.tsx
├── components/
│   └── chat/
│       ├── pay-button.tsx           # Pay button card rendered on create_checkout output
│       ├── seat-map.tsx             # Interactive seat picker
│       └── flight-results.tsx       # Flight cards
└── tests/
    ├── layer1-tool-logic/           # Unit tests — provider logic, password validation (20 tests)
    ├── layer2-mcp-contract/         # MCP contract tests — tool schemas, guest vs auth tools (7 tests)
    └── layer3-llm/                  # LLM integration tests (2 tests — require ANTHROPIC_API_KEY)
```

## What's real vs mocked

| Feature | In sandbox | In production |
|---|---|---|
| Flight search | Real (Duffel sandbox) | Real |
| Seat maps | Real for Duffel Airways + AA test flights; generated fallback for others | Real for all airlines |
| Payments | Stripe test mode (no real charges) | Stripe live mode |
| Email | Real (Gmail SMTP) | Real |
| Auth | Real (GitHub/Google OAuth) | Real |

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
- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com) (free tier)
- `DATABASE_URL` — Neon Postgres connection string from [neon.tech](https://neon.tech)
- `NEXTAUTH_SECRET` — run `openssl rand -base64 32`
- `NEXTAUTH_URL` — `http://localhost:3002` in development
- `GITHUB_ID` + `GITHUB_SECRET` — GitHub OAuth app, callback: `http://localhost:3002/api/auth/callback/github`
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google OAuth app, callback: `http://localhost:3002/api/auth/callback/google`
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` — Gmail account for OTP and booking confirmation emails
- `DUFFEL_API_KEY` — from [duffel.com](https://duffel.com) (free sandbox, token starts with `duffel_test_...`)
- `FLIGHT_PROVIDER` — `duffel` for real data, `mock` for local dev without a Duffel account
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` — from [dashboard.stripe.com](https://dashboard.stripe.com) (test keys)
- `LANGFUSE_SECRET_KEY` + `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_BASEURL` — from [cloud.langfuse.com](https://cloud.langfuse.com) (free tier)

### 3. Push the database schema

```bash
npx drizzle-kit push
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3002](http://localhost:3002).

### 5. (Optional) Test Stripe webhooks locally

Install the Stripe CLI, then:

```bash
stripe listen --forward-to localhost:3002/api/stripe/webhook
```

Copy the printed `whsec_...` key into `STRIPE_WEBHOOK_SECRET`.

### 6. Run tests

```bash
npx vitest run
```

Layer 3 (LLM) tests require `ANTHROPIC_API_KEY` and are skipped gracefully otherwise.

## How it works

**Guest mode** (`/chat/guest`) — messages live in React state only. Refresh = start over. Email OTP verification required before booking.

**Authenticated mode** (`/chat/[id]`) — each message saved to Postgres as a full `UIMessage` JSONB object. Conversations truly resume because tool call history is preserved.

**Payments** — authenticated users go through Stripe Checkout. Claude calls `create_checkout`, a Pay button appears in the chat. After payment, the Stripe webhook confirms the booking in the DB and sends a confirmation email. Guests skip payment entirely.

**Flight data** — Duffel sandbox is active by default (`FLIGHT_PROVIDER=duffel`). Most airlines in sandbox don't return seatmap data — the app generates a deterministic fallback layout so the seat picker always works. Set `FLIGHT_PROVIDER=mock` for offline development.

## Switching back to Claude

Change one line in `app/api/chat/route.ts`:

```ts
// From:
import { groq } from "@ai-sdk/groq";
model: groq("openai/gpt-oss-120b")

// To:
import { anthropic } from "@ai-sdk/anthropic";
model: anthropic("claude-haiku-4-5-20251001")
```

Claude follows skill instructions more reliably than Groq and supports prompt caching.
