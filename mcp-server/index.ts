import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getProvider } from "@/lib/flight-provider/index";
import type { Seat } from "@/lib/flight-provider/index";

// Deterministic fallback seat map for flights where the provider returns no seatmap data.
// Uses flightId as a seed so the same flight always shows the same layout.
function generateFallbackSeats(flightId: string): Seat[] {
  let hash = 0;
  for (let i = 0; i < flightId.length; i++) {
    hash = Math.imul(hash * 31 + flightId.charCodeAt(i), 1);
    hash |= 0;
  }

  const seats: Seat[] = [];
  const columns = ["A", "B", "C", "D", "E", "F"] as const;

  for (let row = 1; row <= 20; row++) {
    for (const col of columns) {
      const type =
        col === "A" || col === "F" ? "window"
        : col === "C" || col === "D" ? "aisle"
        : "middle";
      const seed = Math.abs((hash ^ (row * 7919)) ^ (col.charCodeAt(0) * 1013));
      const available = seed % 10 > 2; // ~70% available
      seats.push({ seatNumber: `${row}${col}`, row, column: col, type, available });
    }
  }
  return seats;
}

export function createTravelMcpServer(): McpServer {
  const server = new McpServer({ name: "travel-mcp", version: "1.0.0" });
  const provider = getProvider();

  server.tool(
    "search_flights",
    "Search for available flights between two cities on a specific date",
    {
      origin:      z.string().describe("IATA airport code e.g. JFK"),
      destination: z.string().describe("IATA airport code e.g. LAX"),
      date:        z.string().describe("Travel date in YYYY-MM-DD format"),
    },
    async ({ origin, destination, date }) => {
      const searchDate = new Date(date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (isNaN(searchDate.getTime()) || searchDate < today) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Travel date must be today or in the future. Please provide a valid future date." }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(await provider.searchFlights({ origin, destination, date }), null, 2) }] };
    }
  );

  server.tool(
    "get_flight_seats",
    "Get the seat map for a flight showing available and taken seats",
    {
      flightId: z.string().describe("Flight ID e.g. F1"),
    },
    async ({ flightId }) => {
      const seats = await provider.getFlightSeats(flightId);
      const result = seats.length > 0 ? seats : generateFallbackSeats(flightId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "book_flight",
    "Book a seat on a flight for a passenger",
    {
      flightId:      z.string().describe("Flight ID e.g. F1"),
      passengerName: z.string().describe("Full name of the passenger"),
      seatNumber:    z.string().describe("Seat number e.g. 12A"),
    },
    async ({ flightId, passengerName, seatNumber }) => {
      const booking = await provider.bookFlight({ flightId, passengerName, seatNumber });
      return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }] };
    }
  );

  server.tool(
    "get_booking",
    "Retrieve the details of an existing booking by its ID",
    {
      bookingId: z.string().describe("Booking ID e.g. BK-1001"),
    },
    async ({ bookingId }) => {
      const booking = await provider.getBooking(bookingId);
      return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }] };
    }
  );

  server.tool(
    "change_seat",
    "Change the seat on an existing booking",
    {
      bookingId: z.string().describe("Booking ID e.g. BK-1001"),
      newSeat:   z.string().describe("New seat number e.g. 5C"),
    },
    async ({ bookingId, newSeat }) => {
      const booking = await provider.changeSeat({ bookingId, newSeat });
      return { content: [{ type: "text", text: JSON.stringify(booking, null, 2) }] };
    }
  );

  return server;
}

// Standalone stdio server — used by Claude Desktop and other MCP clients.
// Run with: npx tsx mcp-server/index.ts
export async function main() {
  const server = createTravelMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
