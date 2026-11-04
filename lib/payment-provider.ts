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
}
