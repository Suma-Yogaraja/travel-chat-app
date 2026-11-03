import { tool } from "ai";
import { z } from "zod";
import { getProvider } from "./flight-provider/index";
import {
  getBookingByRef, updateBookingSeat,
  getBookingByRefOnly, cancelBookingByRef, updateBookingSeatByRef,
  saveBooking, saveGuestOtp, getValidOtp, markOtpUsed,
} from "./db/queries";
import {
  sendBookingConfirmation, sendSeatChangeConfirmation, sendCancellationConfirmation, sendOtpEmail,
} from "./email";

const provider = getProvider();

let gsCounter = 0;
function guestBookingRef() {
  return `GS-${Date.now()}-${(++gsCounter).toString().padStart(3, "0")}`;
}
function guestUserId() {
  return `gs-${Date.now()}`;
}
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

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
        flightId:       z.string().describe("Flight ID e.g. F1"),
        passengerName:  z.string().describe("Full name of the passenger"),
        seatNumber:     z.string().describe("Seat number e.g. 12A"),
        passengerEmail: z.string().email().optional().describe("Required for guest bookings — email address for confirmation"),
      }),
      execute: async ({ flightId, passengerName, seatNumber, passengerEmail }) => {
        // Validate seat availability via mock provider
        const providerResult = await provider.bookFlight({ flightId, passengerName, seatNumber });

        if (!userId) {
          // Guest booking
          if (!passengerEmail) {
            return { error: "Please provide your email address so we can send your booking confirmation." };
          }
          const bookingRef = guestBookingRef();
          const gsUserId = guestUserId();

          await saveBooking({
            userId: gsUserId,
            bookingRef,
            flightId,
            passengerName,
            seat: seatNumber,
            email: passengerEmail,
          });

          await sendBookingConfirmation({
            to: passengerEmail,
            passengerName,
            bookingRef,
            flightId,
            seat: seatNumber,
          }).catch(err => console.error("[book_flight] email error:", err));

          return { bookingId: bookingRef, flightId, passengerName, seat: seatNumber, status: "confirmed" };
        }

        // Authenticated — onStepFinish in route.ts handles DB save and email
        return providerResult;
      },
    }),

    // Authenticated users only — no OTP needed (session proves identity)
    get_booking: tool({
      description: "Retrieve the details of an existing booking by its reference ID",
      inputSchema: z.object({
        bookingId: z.string().describe("Booking reference e.g. BK-1746213305123-001 or GS-1746213305123-001"),
      }),
      execute: async ({ bookingId }) => {
        if (!userId) return { error: "Not authenticated" };
        const booking = await getBookingByRef(bookingId, userId);
        if (!booking) return { error: `Booking ${bookingId} not found` };
        return booking;
      },
    }),

    // Authenticated users only
    change_seat: tool({
      description: "Change the seat on an existing booking (authenticated users only — guests use verify_and_change_seat)",
      inputSchema: z.object({
        bookingId: z.string().describe("Booking reference"),
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

    // Guest booking lookup — no userId check, used to retrieve flightId before showing seat map
    get_guest_booking: tool({
      description: "Look up a guest booking by reference to retrieve flight ID, seat, and passenger name. Use this for GS- bookings before showing the seat map.",
      inputSchema: z.object({
        bookingRef: z.string().describe("Guest booking reference starting with GS-"),
      }),
      execute: async ({ bookingRef }) => {
        if (!bookingRef.startsWith("GS-")) {
          return { error: "This tool is only for guest bookings (GS- prefix)." };
        }
        const booking = await getBookingByRefOnly(bookingRef);
        if (!booking) return { error: `Booking ${bookingRef} not found` };
        if (booking.status === "cancelled") return { error: "This booking is already cancelled" };
        return {
          bookingRef: booking.bookingRef,
          flightId: booking.flightId,
          passengerName: booking.passengerName,
          seat: booking.seat,
          status: booking.status,
        };
      },
    }),

    // --- Guest-only tools (OTP verified) ---

    request_otp: tool({
      description: "Send a one-time password to the email on a guest booking so they can verify their identity before making changes",
      inputSchema: z.object({
        bookingRef: z.string().describe("Guest booking reference starting with GS-"),
      }),
      execute: async ({ bookingRef }) => {
        if (!bookingRef.startsWith("GS-")) {
          return { error: "OTP verification is only for guest bookings (GS- prefix). Signed-in users are already verified." };
        }
        const booking = await getBookingByRefOnly(bookingRef);
        if (!booking) return { error: `Booking ${bookingRef} not found` };
        if (!booking.email) return { error: "No email on file for this booking" };
        if (booking.status === "cancelled") return { error: "This booking is already cancelled" };

        const otp = generateOtp();
        await saveGuestOtp(bookingRef, otp);

        await sendOtpEmail({ to: booking.email, bookingRef, otp })
          .catch(err => console.error("[request_otp] email error:", err));

        return { sent: true, message: "OTP sent to the email on file for this booking. It expires in 10 minutes." };
      },
    }),

    verify_and_cancel: tool({
      description: "Verify OTP and cancel a guest booking",
      inputSchema: z.object({
        bookingRef: z.string().describe("Guest booking reference"),
        otp:        z.string().describe("6-digit OTP from email"),
      }),
      execute: async ({ bookingRef, otp }) => {
        const otpRow = await getValidOtp(bookingRef, otp);
        if (!otpRow) return { error: "Invalid or expired OTP. Request a new one." };

        const booking = await getBookingByRefOnly(bookingRef);
        if (!booking) return { error: `Booking ${bookingRef} not found` };
        if (booking.status === "cancelled") return { error: "This booking is already cancelled" };

        await cancelBookingByRef(bookingRef);
        await markOtpUsed(otpRow.id);

        if (booking.email) {
          sendCancellationConfirmation({
            to: booking.email,
            passengerName: booking.passengerName,
            bookingRef,
            flightId: booking.flightId,
            seat: booking.seat,
          }).catch(() => {});
        }

        return { success: true, message: `Booking ${bookingRef} has been cancelled. A confirmation has been sent to your email.` };
      },
    }),

    verify_and_change_seat: tool({
      description: "Verify OTP and change the seat on a guest booking",
      inputSchema: z.object({
        bookingRef: z.string().describe("Guest booking reference"),
        newSeat:    z.string().describe("New seat number e.g. 5C"),
        otp:        z.string().describe("6-digit OTP from email"),
      }),
      execute: async ({ bookingRef, newSeat, otp }) => {
        const otpRow = await getValidOtp(bookingRef, otp);
        if (!otpRow) return { error: "Invalid or expired OTP. Request a new one." };

        const booking = await getBookingByRefOnly(bookingRef);
        if (!booking) return { error: `Booking ${bookingRef} not found` };
        if (booking.status === "cancelled") return { error: "This booking is already cancelled" };

        const updated = await updateBookingSeatByRef(bookingRef, newSeat);
        await markOtpUsed(otpRow.id);

        if (booking.email) {
          sendSeatChangeConfirmation({
            to: booking.email,
            passengerName: booking.passengerName,
            bookingRef,
            flightId: booking.flightId,
            oldSeat: booking.seat,
            newSeat,
          }).catch(() => {});
        }

        return { success: true, booking: updated, message: `Seat changed to ${newSeat}. A confirmation has been sent to your email.` };
      },
    }),
  };
}
