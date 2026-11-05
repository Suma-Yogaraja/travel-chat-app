import { withStripe } from "./stripe";
import type { PaymentProvider } from "./payment-provider";

export const stripePaymentProvider: PaymentProvider = {
  async createCheckoutSession(params) {
    const session = await withStripe(stripe =>
      stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: `Flight ${params.flightId} — Seat ${params.seatNumber}`,
              description: `Passenger: ${params.passengerName}`,
            },
            unit_amount: params.priceMinor,
          },
          quantity: 1,
        }],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        customer_email: params.customerEmail,
        metadata: {
          bookingRef:    params.bookingRef,
          userId:        params.userId,
          flightId:      params.flightId,
          seatNumber:    params.seatNumber,
          passengerName: params.passengerName,
          offerId:       params.offerId,
        },
        expires_at: Math.floor(params.expiresAt.getTime() / 1000),
      })
    );
    return { id: session.id, url: session.url ?? "" };
  },

  async refundPayment({ stripeSessionId, bookingRef }) {
    await withStripe(async stripe => {
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
      if (typeof session.payment_intent === "string") {
        await stripe.refunds.create(
          { payment_intent: session.payment_intent },
          { idempotencyKey: `refund-${bookingRef}` },
        );
      }
    });
  },

  async expireSession({ stripeSessionId }) {
    await withStripe(stripe => stripe.checkout.sessions.expire(stripeSessionId));
  },
};
