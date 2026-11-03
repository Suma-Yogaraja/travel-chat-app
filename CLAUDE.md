# Travel Chat App

## What this is
A chat-based travel app where users search flights, book tickets, and change seats through conversation with Claude. Built to learn MCP servers, tool calling, streaming, hooks, and AI SDK patterns.

## Architecture
- **MCP server** (`mcp-server/`) exposes 5 travel tools. The app connects via `InMemoryTransport` (see `lib/mcp-bridge.ts`) — no subprocess, no stdio. `mcp-server/main()` is still exported for standalone use with Claude Desktop.
- **Tool split**: `search_flights` + `get_flight_seats` come from the MCP server via `lib/mcp-bridge.ts`. All write/session-aware tools (`book_flight`, `get_booking`, `change_seat`, OTP tools) are direct tools in `lib/tools.ts`.
- **Flight data** comes from `lib/flight-provider/` — always use `getProvider()`, never import mock-provider directly.
- **Skills** in `skills/` are `.md` files loaded once at module level (not per-request) and composed into the system prompt with Anthropic prompt caching.
- **Dual mode**: Guest (`/chat/guest`) = in-memory React state, no DB. Authenticated (`/chat/[id]`) = Postgres-persisted.
- **Auth** via NextAuth v5 (GitHub OAuth). Session available via `auth()` in server components and API routes.
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
- `skills/` — Claude's travel assistant behaviour rules

## Cost optimisations in place
- Model: `claude-haiku-4-5-20251001` (~12× cheaper than Sonnet)
- Prompt caching: system prompt injected as a cached user message with `cacheControl: "ephemeral"`
- Tool result trimming: old seat map / flight search results replaced with one-line placeholders
- Role-based tool filtering: guests get 5 tools, auth users get 3 (MCP) + 3 (direct) = 6
- History cap: last 30 model messages only
- Output cap: `maxOutputTokens: 350`, `stopWhen: stepCountIs(4)`

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

## Still to do
- Real Amadeus flight API via `amadeus-provider.ts` (swap via `FLIGHT_PROVIDER` env var)
- Google OAuth: requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env.local` and Vercel env vars
