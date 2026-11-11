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

export interface SeatUpgradeParams {
  diffMinor: number;
  currency: string;
  bookingRef: string;
  newSeat: string;
  newSeatPriceMinor: number;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentProvider {
  createCheckoutSession(params: CheckoutParams): Promise<{ id: string; url: string }>;
  /** New Stripe session for just the seat upgrade difference. */
  createSeatUpgradeSession(params: SeatUpgradeParams): Promise<{ id: string; url: string }>;
  /** Full refund of a completed payment. Idempotent — keyed to stripeSessionId. */
  refundPayment(params: { stripeSessionId: string; bookingRef: string }): Promise<void>;
  /** Partial refund for a seat downgrade. Amount in minor units. */
  refundPartial(params: { stripeSessionId: string; bookingRef: string; amountMinor: number }): Promise<void>;
  /** Expire an open checkout session before payment is captured. */
  expireSession(params: { stripeSessionId: string }): Promise<void>;
}
