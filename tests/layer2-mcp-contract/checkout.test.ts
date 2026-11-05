import { describe, it, expect, vi, beforeEach } from "vitest";

// All mocks declared before the imports that use them.
vi.mock("../../lib/offers/offer-service", () => ({
  validateOfferForCheckout: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fromMinorUnits: (minor: number, currency: string) => +(minor / 100).toFixed(2),
}));
vi.mock("../../lib/offers/price-confirmation", () => ({
  generatePriceChangeToken: vi.fn().mockReturnValue("tok_price_change_abc"),
  verifyPriceChangeToken:   vi.fn().mockReturnValue({ valid: true }),
}));
vi.mock("../../lib/db/queries", () => ({
  getBookingByRef:              vi.fn(),
  updateBookingSeat:            vi.fn(),
  getBookingByRefOnly:          vi.fn(),
  cancelBookingByRef:           vi.fn(),
  updateBookingSeatByRef:       vi.fn(),
  saveGuestOtp:                 vi.fn(),
  verifyAndConsumeOtp:          vi.fn(),
  saveBookingVerificationOtp:   vi.fn(),
  verifyAndConsumeBookingOtp:   vi.fn().mockResolvedValue({ id: "otp-row-1" }),
  createPendingBooking:         vi.fn().mockResolvedValue(undefined),
  setBookingStripeSession:      vi.fn().mockResolvedValue(undefined),
  deletePendingBooking:         vi.fn().mockResolvedValue(undefined),
}));
// Prevent the real Stripe singleton from initialising during tests.
vi.mock("../../lib/stripe-payment-provider", () => ({
  stripePaymentProvider: { createCheckoutSession: vi.fn() },
}));
vi.mock("../../lib/stripe", () => ({
  withStripe: vi.fn(),
  getStripe:  vi.fn(),
}));

import { createTravelTools } from "../../lib/tools";
import { validateOfferForCheckout } from "../../lib/offers/offer-service";
import { generatePriceChangeToken, verifyPriceChangeToken } from "../../lib/offers/price-confirmation";
import {
  createPendingBooking, verifyAndConsumeBookingOtp,
  setBookingStripeSession, deletePendingBooking,
} from "../../lib/db/queries";
import type { PaymentProvider } from "../../lib/payment-provider";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OFFER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const mockValidate   = vi.mocked(validateOfferForCheckout);
const mockCreateDb      = vi.mocked(createPendingBooking);
const mockSetSession    = vi.mocked(setBookingStripeSession);
const mockDeleteDb      = vi.mocked(deletePendingBooking);
const mockVerifyOtp     = vi.mocked(verifyAndConsumeBookingOtp);
const mockGenToken      = vi.mocked(generatePriceChangeToken);
const mockVerifyTok     = vi.mocked(verifyPriceChangeToken);

function makeProvider(url = "https://checkout.stripe.com/pay/sess_abc123"): PaymentProvider & {
  createCheckoutSession: ReturnType<typeof vi.fn>;
} {
  return { createCheckoutSession: vi.fn().mockResolvedValue({ id: "sess_abc123", url }) };
}

function validOffer(overrides: Record<string, unknown> = {}) {
  return {
    valid: true as const,
    priceMinor: 19999,
    currency: "USD",
    priceChanged: false,
    previousPriceMinor: 19999,
    ...overrides,
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    offerId:       OFFER_ID,
    flightId:      "F1",
    passengerName: "Alice Smith",
    seatNumber:    "12A",
    ...overrides,
  };
}

function getCheckout(ctx: Parameters<typeof createTravelTools>[0]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (createTravelTools(ctx).create_checkout as any).execute as (
    input: ReturnType<typeof baseInput>
  ) => Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Happy path — authenticated user ──────────────────────────────────────────

describe("happy path — authenticated user", () => {
  it("creates checkout session and returns URL", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(validOffer() as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/pay/sess_abc123");
    expect(result.bookingRef).toMatch(/^BK-/);
    expect(result.flightId).toBe("F1");
    expect(result.seatNumber).toBe("12A");
    expect(result.passengerName).toBe("Alice Smith");
  });

  it("passes server-derived price and currency — model cannot influence amount", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(validOffer({ priceMinor: 19999, currency: "USD" }) as never);

    await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinor: 19999, currency: "USD" })
    );
  });

  it("persists a pending booking before Stripe session creation, then links the session ID", async () => {
    // DB row is created first (without stripeSessionId) so a Stripe session always has
    // a matching booking. The session ID is linked in a second UPDATE after Stripe succeeds.
    const provider = makeProvider();
    mockValidate.mockResolvedValue(validOffer() as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(mockCreateDb).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingRef:    result.bookingRef,
        flightId:      "F1",
        seat:          "12A",
        passengerName: "Alice Smith",
      })
    );
    expect(mockCreateDb).toHaveBeenCalledWith(
      expect.not.objectContaining({ stripeSessionId: expect.anything() })
    );
    expect(mockSetSession).toHaveBeenCalledWith(result.bookingRef, "sess_abc123");
  });
});

// ── Happy path — guest ────────────────────────────────────────────────────────

describe("happy path — guest (OTP verified)", () => {
  it("verifies OTP and passes customer_email to provider", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(validOffer() as never);

    const result = await getCheckout({ guestSessionId: "gs-abc", paymentProvider: provider })(
      baseInput({ passengerEmail: "guest@example.com", otp: "123456" })
    );

    expect(mockVerifyOtp).toHaveBeenCalledWith("guest@example.com", "123456");
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: "guest@example.com" })
    );
    expect(result.bookingRef).toMatch(/^GS-/);
  });

  it("returns error when OTP is missing for guest", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(validOffer() as never);

    const result = await getCheckout({ guestSessionId: "gs-abc", paymentProvider: provider })(
      baseInput({ passengerEmail: "guest@example.com" })
    );

    expect(result.error).toMatch(/verification code/i);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns error when OTP is invalid or expired", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(validOffer() as never);
    mockVerifyOtp.mockResolvedValueOnce(null as never);

    const result = await getCheckout({ guestSessionId: "gs-abc", paymentProvider: provider })(
      baseInput({ passengerEmail: "guest@example.com", otp: "000000" })
    );

    expect(result.error).toMatch(/invalid or expired/i);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ── Offer validation errors ───────────────────────────────────────────────────

describe("offer validation errors", () => {
  it("returns structured error when offer is not found", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue({ valid: false, reason: "not_found" } as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.error).toMatch(/not found/i);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns structured error when offer has expired", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue({ valid: false, reason: "expired" } as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.error).toMatch(/expired/i);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("fails closed when Duffel is unreachable — no Stripe session created", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue({ valid: false, reason: "provider_unavailable" } as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.error).toMatch(/unable to verify pricing/i);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockCreateDb).not.toHaveBeenCalled();
  });
});

// ── Price-change flow ─────────────────────────────────────────────────────────

describe("price-change flow", () => {
  it("returns PRICE_CHANGED error with server-signed token on first call", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(
      validOffer({ priceChanged: true, priceMinor: 21999, previousPriceMinor: 19999 }) as never
    );

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.error).toBe("PRICE_CHANGED");
    expect(result.priceChangeToken).toBe("tok_price_change_abc");
    expect(mockGenToken).toHaveBeenCalled();
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("proceeds to checkout when user confirms price via valid priceChangeToken", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(
      validOffer({ priceChanged: true, priceMinor: 21999, previousPriceMinor: 19999 }) as never
    );
    mockVerifyTok.mockReturnValue({ valid: true } as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(
      baseInput({ priceChangeToken: "tok_price_change_abc" })
    );

    expect(result.checkoutUrl).toBeDefined();
    expect(result.error).toBeUndefined();
    // Confirmed price must match the server-validated price, not the old price
    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinor: 21999 })
    );
  });

  it("rejects an invalid or expired priceChangeToken", async () => {
    const provider = makeProvider();
    mockValidate.mockResolvedValue(
      validOffer({ priceChanged: true, priceMinor: 21999, previousPriceMinor: 19999 }) as never
    );
    mockVerifyTok.mockReturnValue({ valid: false } as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(
      baseInput({ priceChangeToken: "tok_stale" })
    );

    expect(result.error).toMatch(/invalid or expired/i);
    expect(provider.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ── Provider / Stripe errors ──────────────────────────────────────────────────

describe("provider error handling", () => {
  it("returns user-facing error when provider throws (Stripe unavailable)", async () => {
    // DB row is created before Stripe is called, so it must be cleaned up on failure.
    const provider = makeProvider();
    provider.createCheckoutSession.mockRejectedValueOnce(new Error("Stripe network error"));
    mockValidate.mockResolvedValue(validOffer() as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.error).toMatch(/payment service unavailable/i);
    expect(mockCreateDb).toHaveBeenCalled();      // DB row created first
    expect(mockDeleteDb).toHaveBeenCalled();      // then cleaned up after Stripe failure
  });

  it("returns user-facing error when provider returns no checkout URL", async () => {
    // Same cleanup path: DB row exists, then Stripe returns no URL → delete pending booking.
    const provider = makeProvider("");
    mockValidate.mockResolvedValue(validOffer() as never);

    const result = await getCheckout({ userId: "user-alice", paymentProvider: provider })(baseInput());

    expect(result.error).toMatch(/payment service unavailable/i);
    expect(mockCreateDb).toHaveBeenCalled();      // DB row created first
    expect(mockDeleteDb).toHaveBeenCalled();      // then cleaned up
  });
});
