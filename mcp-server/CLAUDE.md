# MCP Server

Exports `createTravelMcpServer()` — a factory that creates a configured `McpServer` instance.
The app connects to it in-process via `InMemoryTransport` (see `lib/mcp-bridge.ts`).
`main()` is also exported for standalone stdio use with Claude Desktop or other MCP clients:
  `npx tsx mcp-server/index.ts`

## Rules
- Do NOT add HTTP routes or Express here.
- Every tool must have a Zod schema defining its input parameters.
- Tools must call `getProvider()` from `@/lib/flight-provider` — never access mock data directly.
- Do NOT auto-run on import. The module only exports functions; callers decide when to connect.

## Tools exposed
1. `search_flights` — search by origin, destination, date. Rejects past dates before calling provider.
2. `get_flight_seats` — seat availability for a flight
3. `book_flight` — validate and create a mock booking (no DB, no email — app layer handles that)
4. `get_booking` — retrieve booking from mock provider by ID (standalone use only)
5. `change_seat` — update seat on mock provider booking (standalone use only)

## Note on tools 4 and 5
In the web app, `get_booking` and `change_seat` are served as direct tools from `lib/tools.ts`
because they need DB access and session context. Tools 4 and 5 here are only useful when
running the server standalone (e.g. with Claude Desktop).

## Date validation
`search_flights` validates that the date is today or in the future before calling the provider.
Returns `{ error: "..." }` for past dates — Claude will relay this to the user.
