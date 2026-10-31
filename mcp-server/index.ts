import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getProvider } from "../lib/flight-provider/index.js";

const server = new McpServer({
  name: "travel-mcp",
  version: "1.0.0",
});

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
    const flights = provider.searchFlights({ origin, destination, date });
    return {
      content: [{ type: "text", text: JSON.stringify(flights, null, 2) }],
    };
  }
);

server.tool(
  "get_flight_seats",
  "Get the seat map for a flight showing available and taken seats",
  {
    flightId: z.string().describe("Flight ID e.g. F1"),
  },
  async ({ flightId }) => {
    const seats = provider.getFlightSeats(flightId);
    return {
      content: [{ type: "text", text: JSON.stringify(seats, null, 2) }],
    };
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
    const booking = provider.bookFlight({ flightId, passengerName, seatNumber });
    return {
      content: [{ type: "text", text: JSON.stringify(booking, null, 2) }],
    };
  }
);

server.tool(
  "get_booking",
  "Retrieve the details of an existing booking by its ID",
  {
    bookingId: z.string().describe("Booking ID e.g. BK-1001"),
  },
  async ({ bookingId }) => {
    const booking = provider.getBooking(bookingId);
    return {
      content: [{ type: "text", text: JSON.stringify(booking, null, 2) }],
    };
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
    const booking = provider.changeSeat({ bookingId, newSeat });
    return {
      content: [{ type: "text", text: JSON.stringify(booking, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now listening — process stays alive until stdin closes
}

main().catch(err => {
  console.error("MCP server error:", err);
  process.exit(1);
});
