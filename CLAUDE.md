# Travel Chat App

## What this is
A chat-based travel app where users search flights, book tickets, and change seats through conversation with Claude. Built to learn MCP servers, tool calling, streaming, hooks, and AI SDK patterns.

## Architecture
- **MCP server** (`mcp-server/`) exposes 5 travel tools. The app connects via `InMemoryTransport` (see `lib/mcp-bridge.ts`) — no subprocess, no stdio. `mcp-server/main()` is still exported for standalone use with Claude Desktop.
- **Tool split**: `search_flights` + `get_flight_seats` come from the MCP server via `lib/mcp-bridge.ts`. All write/session-aware tools (`book_flight`, `get_booking`, `change_seat`, OTP tools) are direct tools in `lib/tools.ts`.
- **Flight data** comes from `lib/flight-provider/` — always use `getProvider()`, never import mock-provider directly.
- **Skills** in `skills/` are `.md` files loaded once at module level (not per-request) and composed into the system prompt with Anthropic prompt caching.
- **Dual mode**: Guest (`/chat/guest`) = in-memory React state, no DB. Authenticated (`/chat/[id]`) = Postgres-persisted.
- **Auth** via NextAuth v5 — GitHub OAuth, Google OAuth, Email/Password (Credentials). Session available via `auth()` in server components and API routes.
- **Email** via Nodemailer + Gmail. Requires `GMAIL_USER` and `GMAIL_APP_PASSWORD` in `.env.local`.

## Conventions
- All MCP tool inputs must use Zod schemas.
- Every DB query on conversations/messages/bookings must filter by `session.user.id` — never return data without a userId check.
- Messages stored as JSONB (full UIMessage object), not plain text — preserves tool call history for conversation resumption.
- Guest bookings use a `gs-<timestamp>` userId (not a real users.id row) and store email in `bookings.email`.
- OTP verification is required before any guest booking mutation (seat change, cancel). Auth users are already verified by session.
- Switch mock ↔ real flight API via `FLIGHT_PROVIDER` env var only. Zero code changes needed.
- Skills are loaded at module level in `app/api/chat/route.ts` — do not move them inside the request handler.

## Key files
- `mcp-server/index.ts` — 5 MCP tools, exports `createTravelMcpServer()` and `main()`
- `lib/mcp-bridge.ts` — connects MCP server in-memory, returns AI SDK-compatible tools
- `lib/tools.ts` — session-aware direct tools (book, get_booking, change_seat, OTP)
- `lib/rate-limit.ts` — sliding-window rate limiter (20 req/min per IP, in-memory per process)
- `lib/flight-provider/index.ts` — FlightProvider interface + factory
- `lib/db/schema.ts` — Drizzle table definitions
- `lib/db/queries.ts` — all typed DB helpers
- `lib/auth.ts` — NextAuth config
- `lib/email.ts` — Nodemailer email functions (booking confirm, seat change, cancel, OTP)
- `app/api/chat/route.ts` — main AI streaming route
- `lib/langfuse-processor.ts` — singleton LangfuseSpanProcessor shared by instrumentation + chat route
- `instrumentation.ts` — registers OTel pipeline + AI SDK telemetry integration on startup
- `skills/` — Claude's travel assistant behaviour rules

## Cost optimisations in place
- Model: `claude-haiku-4-5-20251001` (~12× cheaper than Sonnet)
- Prompt caching: system prompt injected as a cached user message with `cacheControl: "ephemeral"`
- Tool result trimming: old seat map / flight search results replaced with one-line placeholders
- Role-based tool filtering: guests get 5 tools, auth users get 3 (MCP) + 3 (direct) = 6
- History cap: last 30 model messages only
- Output cap: `maxOutputTokens: 600`, `stopWhen: stepCountIs(4)`

## Auth providers
- GitHub OAuth, Google OAuth, Email/Password (Credentials) — all configured in `lib/auth.ts`
- Registration: `POST /api/auth/register` → bcrypt hash → `createUserWithPassword`
- Forgot password: `POST /api/auth/forgot-password` → token stored as SHA-256 hash in `password_reset_tokens`, email sent via Nodemailer
- Reset password: `POST /api/auth/reset-password` → verify token hash → `updateUserPassword`
- Password min 8 chars, bcrypt cost 12

## Security model
- Passwords: bcrypt (cost 12) — never stored in plaintext
- Password reset tokens: stored as SHA-256 hashes in `password_reset_tokens`, expire after 1 hour, single-use
- OTPs: stored as SHA-256 hashes in `guest_otps`, expire after 10 minutes, single-use
- Session strategy: JWT (required for Credentials provider to coexist with DrizzleAdapter)
- All DB queries on conversations/messages/bookings filter by `session.user.id`

## Guest email verification
- Before a guest booking, Claude calls `send_booking_otp` with the email → OTP sent, stored hashed in `guest_otps` with `purpose = "booking"`
- Guest confirms code in chat → `book_flight` called with `otp` field → verified via `getValidBookingOtp`, then booking saved
- Existing seat-change/cancel OTP flow unchanged (`purpose = "seat_change"`, keyed by bookingRef)

## Flight date validation
- `search_flights` MCP tool rejects past dates before calling the provider — returns `{ error: "..." }` if date < today
- Mock provider ignores date (matches only on origin/destination) — date guard lives at MCP layer
- Claude also instructed in `skills/flight-search.md` to refuse past dates before calling the tool

## Error handling

### Global API handler (`lib/api-handler.ts`)
All API routes are wrapped with `apiHandler()` — a higher-order function that catches any unhandled error and returns a consistent response:
- `AppError` (thrown intentionally with message + status) → `{ error: message }` JSON with that status
- Anything else → `console.error("[API error] METHOD /path", err)` + 500
- `app/api/auth/forgot-password/route.ts` keeps an inner try/catch to preserve its always-200 contract (prevents email enumeration); the outer `apiHandler` is a safety net on top

### UI error boundaries
- `app/global-error.tsx` — React error boundary; catches any render crash across the whole app, shows "Something went wrong / Try again" instead of a blank screen
- `app/chat/[id]/page.tsx` and `app/chat/guest/page.tsx` — `status === "error"` banner shown at bottom of chat
- `components/bookings/booking-actions.tsx` — cancel errors shown inline; `setLoading(false)` called on failure so the button never stays disabled
- `app/chat/bookings/page.tsx` — DB error shows "Unable to load bookings. Please try again later."

### Auth page error states
All auth pages (`login`, `register`, `forgot-password`, `reset-password`) have `catch` blocks that surface network/server failures as inline error messages — loading state always resets on failure.

### saveMessage in onFinish
`saveMessage` in `onFinish` uses `.catch()` so a DB hiccup never kills the streaming response.

## Observability (Langfuse)

LLM traces are captured via `@langfuse/vercel-ai-sdk` + `@langfuse/otel` (Langfuse v5 SDK stack).

**Setup:**
- `instrumentation.ts`: `registerOTel({ spanProcessors: [langfuseProcessor] })` + `registerTelemetry(new LangfuseVercelAiSdkIntegration())`
- `lib/langfuse-processor.ts`: singleton `LangfuseSpanProcessor({ exportMode: "immediate" })` — shared between instrumentation and the chat route
- `app/api/chat/route.ts`: `telemetry: { isEnabled: true, functionId: "travel-chat", integrations: [langfuseIntegration] }` on `streamText`; `langfuseProcessor.forceFlush()` in `onFinish`
- Requires `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASEURL` env vars (also reads `LANGFUSE_BASE_URL`)

**Why this stack (not `langfuse-vercel` v3):**
Langfuse's server now only accepts spans via their OTel HTTP endpoint (`/api/public/otel/v1/traces`). The old `langfuse-vercel` v3 SDK sent via a proprietary format that was rejected with HTTP 400. AI SDK v7 also replaced `experimental_telemetry`'s OTel global approach with a callback integration system — `registerTelemetry()` is now the correct hook point.

**What Langfuse captures per conversation:**
- Full model input + output with tool calls and results
- Token usage, latency, and cost per trace
- Span hierarchy: `invoke_agent` → `chat` → per-step spans

## Still to do
- Real Amadeus flight API via `amadeus-provider.ts` (swap via `FLIGHT_PROVIDER` env var)
