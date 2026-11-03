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

## Still to do
- Rate limiting on `/api/chat`
- Real Amadeus flight API via `amadeus-provider.ts` (swap via `FLIGHT_PROVIDER` env var)
