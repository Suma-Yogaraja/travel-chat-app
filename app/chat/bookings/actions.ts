"use server";

import { auth } from "@/lib/auth";
import { cancelBooking, getBookingByRef } from "@/lib/db/queries";
import { sendCancellationConfirmation } from "@/lib/email";
import { stripePaymentProvider } from "@/lib/stripe-payment-provider";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export async function cancelBookingAction(bookingRef: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const booking = await getBookingByRef(bookingRef, session.user.id);
  if (!booking) throw new Error("Booking not found");

  if (booking.stripeSessionId) {
    if (booking.paymentStatus === "paid") {
      try {
        await stripePaymentProvider.refundPayment({ stripeSessionId: booking.stripeSessionId, bookingRef });
      } catch (err) {
        logger.error("cancel_booking_action_refund_error", { bookingRef, error: logger.err(err) });
        throw new Error("Could not process your refund. Please contact support.");
      }
    } else if (booking.paymentStatus === "pending") {
      await stripePaymentProvider.expireSession({ stripeSessionId: booking.stripeSessionId }).catch(() => {});
    }
  }

  await cancelBooking(bookingRef, session.user.id);
  revalidatePath("/chat/bookings");

  if (session.user.email) {
    sendCancellationConfirmation({
      to: session.user.email,
      passengerName: booking.passengerName,
      bookingRef,
      flightId: booking.flightId,
      seat: booking.seat,
    }).catch(() => {});
  }
}
