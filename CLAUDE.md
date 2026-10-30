# Travel Chat App

## What this is
A chat-based travel app where users search flights, book tickets, and change seats through conversation with Claude. Built to learn MCP servers, tool calling, streaming, hooks, and AI SDK patterns.

## Architecture
- **MCP server** (`mcp-server/`) exposes 5 travel tools via stdio transport. Claude calls these automatically.
- **Flight data** comes from `lib/flight-provider/` — always use `getProvider()`, never import mock-provider directly.
- **Skills** in `skills/` are `.md` files loaded at request time and composed into the system prompt.
- **Dual mode**: Guest (`/chat/guest`) = in-memory React state, no DB. Authenticated (`/chat/[id]`) = Postgres-persisted.
- **Auth** via NextAuth v5 (GitHub OAuth). Session available via `auth()` in server components and API routes.

## Conventions
- All MCP tool inputs must use Zod schemas.
- Every DB query on conversations/messages/bookings must filter by `session.user.id` — never return data without a userId check.
- Messages stored as JSONB (full CoreMessage object), not plain text — preserves tool call history for conversation resumption.
- MCP client is created and closed per-request (serverless-safe). Do not share a single instance across requests.
- Hooks (`onStepFinish`, `onFinish`) go through utilities in `lib/ai-hooks.ts` — keep the route handler clean.
- Switch mock ↔ real flight API via `FLIGHT_PROVIDER` env var only. Zero code changes needed.

## Key files
- `mcp-server/index.ts` — all 5 MCP tools
- `lib/flight-provider/index.ts` — FlightProvider interface + factory
- `lib/db/schema.ts` — Drizzle table definitions
- `lib/db/queries.ts` — all typed DB helpers
- `lib/auth.ts` — NextAuth config
- `app/api/chat/route.ts` — main AI streaming route
- `skills/` — Claude's travel assistant capabilities

## Phase 2 (not yet)
- HTTP MCP transport for Vercel deployment
- Real Amadeus API via amadeus-provider.ts
- Guest → auth conversation migration
- Auto-generated conversation titles
