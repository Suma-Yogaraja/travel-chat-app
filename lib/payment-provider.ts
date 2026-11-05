export interface CheckoutParams {
  priceMinor: number;
  currency: string;
  flightId: string;
  seatNumber: string;
  passengerName: string;
  customerEmail?: string;
  bookingRef: string;
  userId: string;
  offerId: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface PaymentProvider {
  createCheckoutSession(params: CheckoutParams): Promise<{ id: string; url: string }>;
  /** Refund a completed payment. idempotent — keyed to stripeSessionId. */
  refundPayment(params: { stripeSessionId: string; bookingRef: string }): Promise<void>;
  /** Expire an open checkout session before payment is captured. */
  expireSession(params: { stripeSessionId: string }): Promise<void>;
}
