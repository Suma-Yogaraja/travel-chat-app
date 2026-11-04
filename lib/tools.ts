import { tool } from "ai";
import { z } from "zod";
import { randomUUID, randomInt } from "crypto";
import {
  getBookingByRef, updateBookingSeat,
  getBookingByRefOnly, cancelBookingByRef, updateBookingSeatByRef,
  saveGuestOtp, verifyAndConsumeOtp,
  saveBookingVerificationOtp, verifyAndConsumeBookingOtp, createPendingBooking,
} from "./db/queries";
import {
  sendSeatChangeConfirmation, sendCancellationConfirmation, sendOtpEmail,
} from "./email";
import { validateOfferForCheckout, fromMinorUnits } from "./offers/offer-service";
import { generatePriceChangeToken, verifyPriceChangeToken } from "./offers/price-confirmation";
import type { PaymentProvider } from "./payment-provider";
import { stripePaymentProvider } from "./stripe-payment-provider";

export type TravelToolsContext = {
  userId?: string;
  userEmail?: string;
  guestSessionId?: string;
  paymentProvider?: PaymentProvider;
};

function guestBookingRef() {
  // 122 bits of cryptographically secure randomness — used as bearer credential for guests
  return `GS-${randomUUID().replace(/-/g, "")}`;
}
function guestUserId() {
  return `gs-${randomUUID().slice(0, 12)}`;
}
// crypto.randomInt is cryptographically secure — Math.random() is not
function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

// search_flights and get_flight_seats are served via the MCP server (lib/mcp-bridge.ts).
// This file only defines session-aware tools that need auth/DB context.

export function createTravelTools({
  userId,
  userEmail,
  guestSessionId,
  paymentProvider = stripePaymentProvider,
}: TravelToolsContext) {
  const tools = {
    send_booking_otp: tool({
      description: "Send a 6-digit verification code to a guest's email before booking. Must be called before create_checkout for guest users.",
      inputSchema: z.object({
        email: z.string().email().describe("Email address to send the verification code to"),
      }),
      execute: async ({ email }) => {
        if (userId) return { error: "Not needed for signed-in users." };
        const otp = generateOtp();
        await saveBookingVerificationOtp(email, otp);
        try {
          await sendOtpEmail({ to: email, otp });
        } catch (err) {
          console.error("[send_booking_otp] email error:", err);
          return { error: "Failed to send verification email. Please try again." };
        }
        return { sent: true };
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

        try {
          await sendOtpEmail({ to: booking.email, bookingRef, otp });
        } catch (err) {
          console.error("[request_otp] email error:", err);
          return { error: "Failed to send verification email. Please try again." };
        }

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
        // Atomic verify + consume — single UPDATE prevents double-use
        const otpRow = await verifyAndConsumeOtp(bookingRef, otp);
        if (!otpRow) return { error: "Invalid or expired OTP. Request a new one." };

        const booking = await getBookingByRefOnly(bookingRef);
        if (!booking) return { error: `Booking ${bookingRef} not found` };
        if (booking.status === "cancelled") return { error: "This booking is already cancelled" };

        await cancelBookingByRef(bookingRef);

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
        // Atomic verify + consume — single UPDATE prevents double-use
        const otpRow = await verifyAndConsumeOtp(bookingRef, otp);
        if (!otpRow) return { error: "Invalid or expired OTP. Request a new one." };

        const booking = await getBookingByRefOnly(bookingRef);
        if (!booking) return { error: `Booking ${bookingRef} not found` };
        if (booking.status === "cancelled") return { error: "This booking is already cancelled" };

        const updated = await updateBookingSeatByRef(bookingRef, newSeat);

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
      description: "Create a Stripe payment session to book a flight. Works for both signed-in users and guests. For guests, send_booking_otp must be called first — include passengerEmail and otp. Pass the offerId from search results — never pass a price. Returns a checkout URL — the chat will show a Pay button.",
      inputSchema: z.object({
        offerId:            z.string().uuid().describe("Offer UUID returned by search_flights — identifies the flight and authorises the server-side price"),
        flightId:           z.string().describe("Human-readable flight ID e.g. F1 or DF-JFK-LAX-2026-11-05-0 — used for display only"),
        passengerName:      z.string().describe("Full name of the passenger"),
        seatNumber:         z.string().describe("Seat number e.g. 12A"),
        passengerEmail:     z.string().email().optional().describe("Required for guest bookings — email address"),
        otp:              z.string().length(6).optional().describe("Required for guest bookings — 6-digit code sent to email"),
        priceChangeToken: z.string().optional().describe("Server-issued token returned from a previous PRICE_CHANGED error. Pass it back unchanged to confirm the user accepted the new price."),
      }),
      execute: async ({ offerId, flightId, passengerName, seatNumber, passengerEmail, otp, priceChangeToken }) => {
        // Validate offer and re-check price with provider. Fail closed: if Duffel is
        // unreachable, return an error rather than charging a potentially stale price.
        const context = { userId, guestSessionId };
        const validation = await validateOfferForCheckout(offerId, context);

        if (!validation.valid) {
          if (validation.reason === "not_found")            return { error: "Offer not found. Please search for flights again." };
          if (validation.reason === "expired")              return { error: "This offer has expired. Please search for flights again to get current pricing." };
          if (validation.reason === "provider_unavailable") return { error: "Unable to verify pricing with the airline. Please try again in a moment." };
          // "unauthorized" maps to not_found (already returned above via same path)
          return { error: "Offer not found. Please search for flights again." };
        }

        const { priceMinor, currency, priceChanged, previousPriceMinor } = validation;

        if (priceChanged) {
          if (priceChangeToken) {
            // Verify the token is bound to this exact offer, freshly-validated price,
            // currency, and user. Prevents replay across offers, users, or time windows.
            const result = verifyPriceChangeToken(priceChangeToken, {
              offerId,
              priceMinor,
              currency,
              userId: userId ?? null,
            });
            if (!result.valid) {
              return { error: "Price confirmation is invalid or expired. Please restart the booking." };
            }
            // Verified — fall through to checkout creation at the confirmed price
          } else {
            // Issue a server-signed token the model must return for the user to confirm
            const token = generatePriceChangeToken({
              offerId,
              priceMinor,
              currency,
              userId: userId ?? null,
            });
            const previousPriceDisplay = fromMinorUnits(previousPriceMinor, currency);
            const currentPriceDisplay  = fromMinorUnits(priceMinor, currency);
            return {
              error: "PRICE_CHANGED",
              previousPriceUsd:  previousPriceDisplay,
              currentPriceUsd:   currentPriceDisplay,
              priceChangeToken:  token,
              message: `The price has changed from $${previousPriceDisplay} to $${currentPriceDisplay} ${currency}. Tell the user the new price and ask them to confirm. If they accept, call create_checkout again with the priceChangeToken included.`,
            };
          }
        }

        let effectiveUserId: string;
        let effectiveEmail: string | undefined;
        let bookingRef: string;

        if (!userId) {
          // Guest path — OTP required to prove email ownership before payment
          if (!passengerEmail) return { error: "Please provide your email address." };
          if (!otp) return { error: "Please provide the 6-digit verification code sent to your email." };
          const otpRow = await verifyAndConsumeBookingOtp(passengerEmail, otp);
          if (!otpRow) return { error: "Invalid or expired verification code. Please request a new one." };
          effectiveUserId = guestUserId();
          effectiveEmail = passengerEmail;
          bookingRef = guestBookingRef();
        } else {
          effectiveUserId = userId;
          effectiveEmail = userEmail;
          bookingRef = `BK-${Date.now()}-${randomUUID().slice(0, 8)}`;
        }

        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        const priceUsdDisplay = fromMinorUnits(priceMinor, currency);
        const baseUrl = process.env.NEXTAUTH_URL ?? "";

        let sessionId: string;
        let checkoutUrl: string;
        try {
          const result = await paymentProvider.createCheckoutSession({
            priceMinor,
            currency,
            flightId,
            seatNumber,
            passengerName,
            customerEmail: effectiveEmail,
            bookingRef,
            userId: effectiveUserId,
            offerId,
            successUrl: `${baseUrl}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}${userId ? "/chat" : "/chat/guest"}`,
            expiresAt,
          });
          sessionId = result.id;
          checkoutUrl = result.url;
        } catch (err) {
          console.error("[create_checkout] payment provider error:", err);
          return { error: "Payment service unavailable. Please try again shortly." };
        }

        if (!checkoutUrl) {
          console.error("[create_checkout] provider returned no checkout URL for session", sessionId);
          return { error: "Payment service unavailable. Please try again shortly." };
        }

        await createPendingBooking({
          userId: effectiveUserId,
          bookingRef,
          flightId,
          passengerName,
          seat: seatNumber,
          email: effectiveEmail,
          stripeSessionId: sessionId,
          expiresAt,
        });

        return {
          checkoutUrl,
          bookingRef,
          priceUsd: priceUsdDisplay,
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
    create_checkout:        tools.create_checkout,
    get_guest_booking:      tools.get_guest_booking,
    request_otp:            tools.request_otp,
    verify_and_cancel:      tools.verify_and_cancel,
    verify_and_change_seat: tools.verify_and_change_seat,
  };
}
