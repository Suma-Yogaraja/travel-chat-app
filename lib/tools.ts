import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getProvider } from "./flight-provider/index";
import {
  getBookingByRef, updateBookingSeat,
  getBookingByRefOnly, cancelBookingByRef, updateBookingSeatByRef,
  saveBooking, saveGuestOtp, getValidOtp, markOtpUsed,
  saveBookingVerificationOtp, getValidBookingOtp, createPendingBooking,
} from "./db/queries";
import {
  sendBookingConfirmation, sendSeatChangeConfirmation, sendCancellationConfirmation, sendOtpEmail,
} from "./email";
import { withStripe } from "./stripe";

const provider = getProvider();

function guestBookingRef() {
  return `GS-${Date.now()}-${randomUUID().slice(0, 8)}`;
}
function guestUserId() {
  return `gs-${randomUUID().slice(0, 12)}`;
}
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// search_flights and get_flight_seats are served via the MCP server (lib/mcp-bridge.ts).
// This file only defines session-aware tools that need auth/DB context.

export function createTravelTools(userId: string | undefined, userEmail?: string) {
  const tools = {
    send_booking_otp: tool({
      description: "Send a 6-digit verification code to a guest's email before booking. Must be called before book_flight for guest users.",
      inputSchema: z.object({
        email: z.string().email().describe("Email address to send the verification code to"),
      }),
      execute: async ({ email }) => {
        if (userId) return { error: "Not needed for signed-in users." };
        const otp = generateOtp();
        await saveBookingVerificationOtp(email, otp);
        await sendOtpEmail({ to: email, otp })
          .catch(err => console.error("[send_booking_otp] email error:", err));
        return { sent: true };
      },
    }),

    book_flight: tool({
      description: "Book a seat on a flight for a passenger. For guests, send_booking_otp must be called first and the guest must confirm the code.",
      inputSchema: z.object({
        flightId:       z.string().describe("Flight ID e.g. F1"),
        passengerName:  z.string().describe("Full name of the passenger"),
        seatNumber:     z.string().describe("Seat number e.g. 12A"),
        passengerEmail: z.string().email().optional().describe("Required for guest bookings — email address for confirmation"),
        otp:            z.string().length(6).optional().describe("Required for guest bookings — 6-digit code sent to email"),
      }),
      execute: async ({ flightId, passengerName, seatNumber, passengerEmail, otp }) => {
        // Validate seat availability via mock provider
        const providerResult = await provider.bookFlight({ flightId, passengerName, seatNumber });

        if (!userId) {
          // Guest booking — verify email ownership via OTP
          if (!passengerEmail) {
            return { error: "Please provide your email address so we can send your booking confirmation." };
          }
          if (!otp) {
            return { error: "Please provide the 6-digit verification code sent to your email." };
          }
          const otpRow = await getValidBookingOtp(passengerEmail, otp);
          if (!otpRow) {
            return { error: "Invalid or expired verification code. Please request a new one." };
          }
          await markOtpUsed(otpRow.id);

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

    create_checkout: tool({
      description: "Create a Stripe payment session to book a flight. Use this for authenticated (signed-in) users. Returns a checkout URL — the chat will show a Pay button.",
      inputSchema: z.object({
        flightId:      z.string().describe("Flight ID e.g. F1 or DF-JFK-LAX-2026-11-05-0"),
        passengerName: z.string().describe("Full name of the passenger"),
        seatNumber:    z.string().describe("Seat number e.g. 12A"),
        priceUsd:      z.number().positive().describe("Price in USD as shown to the user"),
      }),
      execute: async ({ flightId, passengerName, seatNumber, priceUsd }) => {
        if (!userId) return { error: "Sign in required to pay for a booking." };
        if (priceUsd <= 0 || priceUsd > 10_000) return { error: "Invalid price." };

        const bookingRef = `BK-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30-min window

        let session: Awaited<ReturnType<typeof import("stripe")["default"]["prototype"]["checkout"]["sessions"]["create"]>>;
        try {
          session = await withStripe(stripe =>
            stripe.checkout.sessions.create({
              mode: "payment",
              line_items: [{
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: `Flight ${flightId} — Seat ${seatNumber}`,
                    description: `Passenger: ${passengerName}`,
                  },
                  unit_amount: Math.round(priceUsd * 100),
                },
                quantity: 1,
              }],
              success_url: `${process.env.NEXTAUTH_URL}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
              cancel_url: `${process.env.NEXTAUTH_URL}/chat`,
              customer_email: userEmail,
              metadata: { bookingRef, userId, flightId, seatNumber, passengerName },
              expires_at: Math.floor(expiresAt.getTime() / 1000),
            })
          );
        } catch (err) {
          console.error("[create_checkout] Stripe error:", err);
          return { error: "Payment service unavailable. Please try again shortly." };
        }

        await createPendingBooking({
          userId,
          bookingRef,
          flightId,
          passengerName,
          seat: seatNumber,
          email: userEmail,
          stripeSessionId: session.id,
          expiresAt,
        });

        return {
          checkoutUrl: session.url!,
          bookingRef,
          priceUsd,
          flightId,
          seatNumber,
          passengerName,
        };
      },
    }),
  };

  // Only send tools the user can actually use — search_flights + get_flight_seats
  // come from the MCP server (lib/mcp-bridge.ts) and are merged in the route.
  if (userId) {
    return {
      create_checkout: tools.create_checkout,
      get_booking:     tools.get_booking,
      change_seat:     tools.change_seat,
    };
  }
  return {
    send_booking_otp:       tools.send_booking_otp,
    book_flight:            tools.book_flight,
    get_guest_booking:      tools.get_guest_booking,
    request_otp:            tools.request_otp,
    verify_and_cancel:      tools.verify_and_cancel,
    verify_and_change_seat: tools.verify_and_change_seat,
  };
}
