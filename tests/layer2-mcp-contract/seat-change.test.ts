import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/offers/offer-service", () => ({
  validateOfferForCheckout: vi.fn(),
  fromMinorUnits: (minor: number, _currency: string) => +(minor / 100).toFixed(2),
}));
vi.mock("../../lib/offers/price-confirmation", () => ({
  generatePriceChangeToken: vi.fn().mockReturnValue("tok_abc"),
  verifyPriceChangeToken:   vi.fn().mockReturnValue({ valid: true }),
}));
vi.mock("../../lib/offers/offer-repository", () => ({
  getFlightOfferById: vi.fn(),
}));
vi.mock("../../lib/db/queries", () => ({
  getBookingByRef:                vi.fn(),
  updateBookingSeat:              vi.fn(),
  updateBookingSeatAndPrice:      vi.fn(),
  updateBookingSeatAndPriceByRef: vi.fn(),
  updateBookingSeatByRef:         vi.fn(),
  getBookingByRefOnly:            vi.fn(),
  cancelBookingByRef:             vi.fn(),
  saveGuestOtp:                   vi.fn(),
  verifyAndConsumeOtp:            vi.fn().mockResolvedValue({ id: "otp-row" }),
  saveBookingVerificationOtp:     vi.fn(),
  verifyAndConsumeBookingOtp:     vi.fn().mockResolvedValue({ id: "otp-row" }),
  createPendingBooking:           vi.fn().mockResolvedValue(undefined),
  setBookingStripeSession:        vi.fn().mockResolvedValue(undefined),
  deletePendingBooking:           vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/stripe-payment-provider", () => ({
  stripePaymentProvider: { createCheckoutSession: vi.fn() },
}));
vi.mock("../../lib/stripe", () => ({ withStripe: vi.fn(), getStripe: vi.fn() }));
vi.mock("../../lib/email", () => ({
  sendSeatChangeConfirmation: vi.fn().mockResolvedValue(undefined),
  sendCancellationConfirmation: vi.fn().mockResolvedValue(undefined),
  sendOtpEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/seat-pricing", () => ({
  mockSeatSurchargeMinor: vi.fn(),
}));

import { createTravelTools } from "../../lib/tools";
import { getBookingByRef, updateBookingSeat, updateBookingSeatAndPrice, updateBookingSeatAndPriceByRef, getBookingByRefOnly, verifyAndConsumeOtp, updateBookingSeatByRef } from "../../lib/db/queries";
import { getFlightOfferById } from "../../lib/offers/offer-repository";
import { mockSeatSurchargeMinor } from "../../lib/seat-pricing";
import type { PaymentProvider } from "../../lib/payment-provider";

const BOOKING_REF = "BK-123";
const OFFER_ID    = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const mockGetBooking       = vi.mocked(getBookingByRef);
const mockUpdateSeat       = vi.mocked(updateBookingSeat);
const mockUpdateSeatPrice  = vi.mocked(updateBookingSeatAndPrice);
const mockGetOffer         = vi.mocked(getFlightOfferById);
const mockMockSurcharge    = vi.mocked(mockSeatSurchargeMinor);
const mockGetBookingOnly   = vi.mocked(getBookingByRefOnly);
const mockVerifyOtp        = vi.mocked(verifyAndConsumeOtp);
const mockUpdateSeatPriceByRef = vi.mocked(updateBookingSeatAndPriceByRef);
const mockUpdateSeatByRef  = vi.mocked(updateBookingSeatByRef);

function makeProvider(): PaymentProvider & {
  createSeatUpgradeSession: ReturnType<typeof vi.fn>;
  refundPartial: ReturnType<typeof vi.fn>;
} {
  return {
    createCheckoutSession:   vi.fn().mockResolvedValue({ id: "sess", url: "https://checkout.stripe.com/pay/sess" }),
    createSeatUpgradeSession: vi.fn().mockResolvedValue({ id: "sess_upg", url: "https://checkout.stripe.com/pay/upg" }),
    refundPayment:           vi.fn().mockResolvedValue(undefined),
    refundPartial:           vi.fn().mockResolvedValue(undefined),
    expireSession:           vi.fn().mockResolvedValue(undefined),
  };
}

function booking(seatPriceMinor = 0, seat = "7B") {
  return {
    id: "bk-1",
    bookingRef: BOOKING_REF,
    userId: "user-1",
    flightId: "F1",
    offerId: OFFER_ID,
    passengerName: "Test User",
    seat,
    email: null,
    status: "confirmed",
    stripeSessionId: "sess_orig",
    paymentStatus: "paid",
    seatPriceMinor,
    expiresAt: null,
    createdAt: new Date(),
  };
}

function mockOffer(seatPrices: Record<string, number> | null, provider = "mock") {
  return {
    id: OFFER_ID,
    provider,
    seatPrices,
    providerOfferId: null,
    ownerUserId: "user-1",
    guestSessionId: null,
    origin: "JFK", destination: "LAX",
    departureAt: new Date(),
    cabinClass: "economy",
    segments: {},
    priceMinor: 19999,
    currency: "USD",
    expiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("change_seat — upgrade (new seat costs more)", () => {
  it("returns upgradeRequired with checkout URL for the difference", async () => {
    const provider = makeProvider();
    const tools = createTravelTools({ userId: "user-1", paymentProvider: provider });

    mockGetBooking.mockResolvedValue(booking(1500, "7C")); // aisle $15 → 1500 minor
    mockGetOffer.mockResolvedValue(mockOffer({ "12A": 5000 })); // window $50 → 5000 minor

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .change_seat.execute({ bookingId: BOOKING_REF, newSeat: "12A" });

    expect(result).toMatchObject({
      upgradeRequired: true,
      checkoutUrl: expect.stringContaining("stripe.com"),
      diffUsd: 35,   // (5000 - 1500) / 100 = $35
      newSeat: "12A",
    });
    expect(provider.createSeatUpgradeSession).toHaveBeenCalledWith(expect.objectContaining({
      diffMinor: 3500,
      bookingRef: BOOKING_REF,
      newSeat: "12A",
      newSeatPriceMinor: 5000,
    }));
    expect(mockUpdateSeat).not.toHaveBeenCalled();
  });

  it("falls back to mockSeatSurchargeMinor when offer has no seatPrices", async () => {
    const provider = makeProvider();
    const tools = createTravelTools({ userId: "user-1", paymentProvider: provider });

    mockGetBooking.mockResolvedValue(booking(0, "7B")); // free middle seat
    mockGetOffer.mockResolvedValue(mockOffer(null, "mock")); // no seat prices cached
    mockMockSurcharge.mockReturnValue(3000); // window $30

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .change_seat.execute({ bookingId: BOOKING_REF, newSeat: "6A" });

    expect(result).toMatchObject({ upgradeRequired: true, diffUsd: 30 });
  });
});

describe("change_seat — downgrade (new seat costs less)", () => {
  it("issues partial refund and updates the seat", async () => {
    const provider = makeProvider();
    const updated = booking(1500, "12A");
    const tools = createTravelTools({ userId: "user-1", paymentProvider: provider });

    mockGetBooking.mockResolvedValue(booking(5000, "12A")); // was window $50
    mockGetOffer.mockResolvedValue(mockOffer({ "7C": 1500 })); // aisle $15
    mockUpdateSeatPrice.mockResolvedValue(updated);

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .change_seat.execute({ bookingId: BOOKING_REF, newSeat: "7C" });

    expect(result).toMatchObject({ success: true, refundUsd: 35 });
    expect(provider.refundPartial).toHaveBeenCalledWith({
      stripeSessionId: "sess_orig",
      bookingRef: BOOKING_REF,
      amountMinor: 3500,  // 5000 - 1500
    });
    expect(mockUpdateSeatPrice).toHaveBeenCalledWith(BOOKING_REF, "user-1", "7C", 1500);
  });

  it("skips refund if booking is not paid", async () => {
    const provider = makeProvider();
    const tools = createTravelTools({ userId: "user-1", paymentProvider: provider });
    const unpaidBooking = { ...booking(5000, "12A"), paymentStatus: "pending" };

    mockGetBooking.mockResolvedValue(unpaidBooking);
    mockGetOffer.mockResolvedValue(mockOffer({ "7B": 0 }));
    mockUpdateSeatPrice.mockResolvedValue(booking(0, "7B"));

    await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .change_seat.execute({ bookingId: BOOKING_REF, newSeat: "7B" });

    expect(provider.refundPartial).not.toHaveBeenCalled();
  });
});

describe("change_seat — same price", () => {
  it("swaps seat without any payment or refund", async () => {
    const provider = makeProvider();
    const tools = createTravelTools({ userId: "user-1", paymentProvider: provider });

    mockGetBooking.mockResolvedValue(booking(3000, "6A")); // window $30
    mockGetOffer.mockResolvedValue(mockOffer({ "6F": 3000 })); // also window $30

    mockUpdateSeat.mockResolvedValue(booking(3000, "6F"));

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .change_seat.execute({ bookingId: BOOKING_REF, newSeat: "6F" });

    expect(result).toMatchObject({ success: true });
    expect(provider.createSeatUpgradeSession).not.toHaveBeenCalled();
    expect(provider.refundPartial).not.toHaveBeenCalled();
    expect(mockUpdateSeat).toHaveBeenCalledWith(BOOKING_REF, "user-1", "6F");
  });
});

describe("create_checkout — seat surcharge added to flight price", () => {
  it("charges flight price + seat surcharge", async () => {
    const { validateOfferForCheckout } = await import("../../lib/offers/offer-service");
    const mockValidate = vi.mocked(validateOfferForCheckout);

    const offer = mockOffer({ "1A": 5000 }); // front window $50
    mockValidate.mockResolvedValue({
      valid: true,
      priceMinor: 20000,  // $200 flight
      currency: "USD",
      priceChanged: false,
      previousPriceMinor: 20000,
      offer: offer as never,
    });

    const provider = makeProvider();
    const tools = createTravelTools({ userId: "user-1", userEmail: "test@example.com", paymentProvider: provider });

    const { createPendingBooking, verifyAndConsumeBookingOtp: _otp } = await import("../../lib/db/queries");
    vi.mocked(createPendingBooking).mockResolvedValue(undefined as never);

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .create_checkout.execute({
        offerId: OFFER_ID,
        flightId: "F1",
        passengerName: "Test User",
        seatNumber: "1A",
      });

    // Total = $200 flight + $50 window seat = $250
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceMinor: 25000,
    }));
    expect(result).toMatchObject({ priceUsd: 250 });
  });

  it("does not add surcharge for free seats", async () => {
    const { validateOfferForCheckout } = await import("../../lib/offers/offer-service");
    const mockValidate = vi.mocked(validateOfferForCheckout);

    const offer = mockOffer({ "7B": 0 }); // free middle seat
    mockValidate.mockResolvedValue({
      valid: true,
      priceMinor: 20000,
      currency: "USD",
      priceChanged: false,
      previousPriceMinor: 20000,
      offer: offer as never,
    });

    const provider = makeProvider();
    const tools = createTravelTools({ userId: "user-1", userEmail: "test@example.com", paymentProvider: provider });

    const { createPendingBooking } = await import("../../lib/db/queries");
    vi.mocked(createPendingBooking).mockResolvedValue(undefined as never);

    await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .create_checkout.execute({
        offerId: OFFER_ID,
        flightId: "F1",
        passengerName: "Test User",
        seatNumber: "7B",
      });

    expect(provider.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      priceMinor: 20000, // unchanged
    }));
  });
});

describe("verify_and_change_seat (guest) — upgrade path", () => {
  it("returns upgradeRequired after OTP verification", async () => {
    const provider = makeProvider();
    const tools = createTravelTools({ guestSessionId: "gs-abc", paymentProvider: provider });

    mockGetBookingOnly.mockResolvedValue({
      ...booking(0, "7B"),
      userId: "gs-abc",
      stripeSessionId: "sess_gs",
    });
    mockVerifyOtp.mockResolvedValue({ id: "otp-1" } as never);
    mockGetOffer.mockResolvedValue(mockOffer({ "1A": 5000 }));

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .verify_and_change_seat.execute({ bookingRef: BOOKING_REF, newSeat: "1A", otp: "123456" });

    expect(result).toMatchObject({ upgradeRequired: true, diffUsd: 50 });
  });

  it("issues partial refund on downgrade after OTP verification", async () => {
    const provider = makeProvider();
    const tools = createTravelTools({ guestSessionId: "gs-abc", paymentProvider: provider });

    mockGetBookingOnly.mockResolvedValue({
      ...booking(5000, "1A"),
      userId: "gs-abc",
      stripeSessionId: "sess_gs",
    });
    mockVerifyOtp.mockResolvedValue({ id: "otp-1" } as never);
    mockGetOffer.mockResolvedValue(mockOffer({ "7B": 0 }));
    mockUpdateSeatPriceByRef.mockResolvedValue(booking(0, "7B") as never);

    const result = await (tools as unknown as Record<string, { execute: (i: unknown) => Promise<unknown> }>)
      .verify_and_change_seat.execute({ bookingRef: BOOKING_REF, newSeat: "7B", otp: "123456" });

    expect(result).toMatchObject({ success: true, refundUsd: 50 });
    expect(provider.refundPartial).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5000 }));
  });
});
