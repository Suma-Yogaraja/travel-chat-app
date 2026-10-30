# MCP Server

This is a stdio MCP server. It communicates with the parent process via stdin/stdout only.

## Rules
- Do NOT add HTTP routes or Express here.
- Every tool must have a Zod schema defining its input parameters.
- Tools must call `getProvider()` from `lib/flight-provider` — never access mock data directly.
- The server process is spawned per-request by the Next.js API route and closed after the response.

## Tools exposed
1. `search_flights` — search by origin, destination, date
2. `get_flight_seats` — seat availability for a flight
3. `book_flight` — create a booking
4. `get_booking` — retrieve booking details by ID
5. `change_seat` — update seat on an existing booking
