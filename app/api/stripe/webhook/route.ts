import { getStripe } from "@/lib/stripe";
import { getBookingByStripeSession, confirmBooking, expireBooking } from "@/lib/db/queries";
import { sendBookingConfirmation } from "@/lib/email";
import type Stripe from "stripe";

// Webhook must NOT parse the body — Stripe signature verification needs the raw bytes.
export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const booking = await getBookingByStripeSession(session.id);

    // Idempotency: only act on pending bookings.
    // Both this check and the SQL WHERE guard must agree — the SQL is the
    // final defence; this check prevents redundant DB writes + duplicate emails.
    if (booking && booking.paymentStatus === "pending") {
      // confirmBooking returns true only if this handler won the SQL race
      // (UPDATE WHERE paymentStatus='pending' updated 1 row). A concurrent
      // delivery that also passed the app-level check will get false here and
      // must not send a duplicate email.
      const confirmed = await confirmBooking(session.id);

      if (confirmed) {
        const email = booking.email ?? session.customer_email;
        if (email) {
          await sendBookingConfirmation({
            to: email,
            passengerName: booking.passengerName,
            bookingRef: booking.bookingRef,
            flightId: booking.flightId,
            seat: booking.seat,
          }).catch(err => console.error("[webhook] confirmation email error:", err));
        }
      }
    }
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const booking = await getBookingByStripeSession(session.id);
    // App-level guard mirrors the SQL WHERE paymentStatus = 'pending' guard —
    // avoids a redundant DB write for sessions that completed or were never persisted.
    // The SQL guard remains the final authority; this read is not atomic with the update.
    if (booking?.paymentStatus === "pending") {
      await expireBooking(session.id); // let errors propagate — Stripe retries on non-200
    }
  }

  return new Response("ok");
}
