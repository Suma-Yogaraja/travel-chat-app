import { tool } from "ai";
import { z } from "zod";
import { getProvider } from "./flight-provider/index";

const provider = getProvider();

// Same 5 tools as mcp-server/index.ts — inline AI SDK format.
// Works in any serverless environment (Vercel, AWS Lambda) with no subprocess.
// mcp-server/index.ts stays untouched for local Claude Desktop / dev tooling.
// Swap flight providers via FLIGHT_PROVIDER env var — zero changes here.

export const travelTools = {
  search_flights: tool({
    description: "Search for available flights between two cities on a specific date",
    inputSchema: z.object({
      origin:      z.string().describe("IATA airport code e.g. JFK"),
      destination: z.string().describe("IATA airport code e.g. LAX"),
      date:        z.string().describe("Travel date in YYYY-MM-DD format"),
    }),
    execute: async ({ origin, destination, date }) =>
      provider.searchFlights({ origin, destination, date }),
  }),

  get_flight_seats: tool({
    description: "Get the seat map for a flight showing available and taken seats",
    inputSchema: z.object({
      flightId: z.string().describe("Flight ID e.g. F1"),
    }),
    execute: async ({ flightId }) => provider.getFlightSeats(flightId),
  }),

  book_flight: tool({
    description: "Book a seat on a flight for a passenger",
    inputSchema: z.object({
      flightId:      z.string().describe("Flight ID e.g. F1"),
      passengerName: z.string().describe("Full name of the passenger"),
      seatNumber:    z.string().describe("Seat number e.g. 12A"),
    }),
    execute: async ({ flightId, passengerName, seatNumber }) =>
      provider.bookFlight({ flightId, passengerName, seatNumber }),
  }),

  get_booking: tool({
    description: "Retrieve the details of an existing booking by its ID",
    inputSchema: z.object({
      bookingId: z.string().describe("Booking ID e.g. BK-1001"),
    }),
    execute: async ({ bookingId }) => provider.getBooking(bookingId),
  }),

  change_seat: tool({
    description: "Change the seat on an existing booking",
    inputSchema: z.object({
      bookingId: z.string().describe("Booking ID e.g. BK-1001"),
      newSeat:   z.string().describe("New seat number e.g. 5C"),
    }),
    execute: async ({ bookingId, newSeat }) =>
      provider.changeSeat({ bookingId, newSeat }),
  }),
};
