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

    // Idempotency: if already paid, skip
    if (booking && booking.paymentStatus !== "paid") {
      await confirmBooking(session.id);

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
  } else if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    await expireBooking(session.id).catch(err =>
      console.error("[webhook] expire error:", err)
    );
  }

  return new Response("ok");
}
