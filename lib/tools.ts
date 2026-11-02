import { tool } from "ai";
import { z } from "zod";
import { getProvider } from "./flight-provider/index";
import { getBookingByRef, updateBookingSeat } from "./db/queries";
import { sendSeatChangeConfirmation } from "./email";

const provider = getProvider();

// search_flights, get_flight_seats, book_flight use the mock provider (stateless — flight data only).
// get_booking and change_seat use the DB directly: the mock provider's in-memory booking store
// resets on every Vercel cold start, so those tools would always 404 after the first instance dies.

export function createTravelTools(userId: string | undefined, userEmail?: string) {
  return {
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
      description: "Retrieve the details of an existing booking by its reference ID",
      inputSchema: z.object({
        bookingId: z.string().describe("Booking reference e.g. BK-1746213305123-001"),
      }),
      execute: async ({ bookingId }) => {
        if (!userId) return { error: "Not authenticated" };
        const booking = await getBookingByRef(bookingId, userId);
        if (!booking) return { error: `Booking ${bookingId} not found` };
        return booking;
      },
    }),

    change_seat: tool({
      description: "Change the seat on an existing booking",
      inputSchema: z.object({
        bookingId: z.string().describe("Booking reference e.g. BK-1746213305123-001"),
        newSeat:   z.string().describe("New seat number e.g. 5C"),
      }),
      execute: async ({ bookingId, newSeat }) => {
        if (!userId) return { error: "Not authenticated" };
        const existing = await getBookingByRef(bookingId, userId);
        if (!existing) return { error: `Booking ${bookingId} not found` };
        const updated = await updateBookingSeat(bookingId, userId, newSeat);
        if (!updated) return { error: `Failed to update booking ${bookingId}` };
        if (userEmail) {
          sendSeatChangeConfirmation({
            to: userEmail,
            passengerName: existing.passengerName,
            bookingRef: bookingId,
            flightId: existing.flightId,
            oldSeat: existing.seat,
            newSeat,
          }).catch(() => {});
        }
        return updated;
      },
    }),
  };
}
