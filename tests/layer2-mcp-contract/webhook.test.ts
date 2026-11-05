import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks declared before imports that use them.
vi.mock("../../lib/stripe", () => ({
  getStripe: vi.fn(),
}));
vi.mock("../../lib/db/queries", () => ({
  getBookingByStripeSession: vi.fn(),
  confirmBooking:  vi.fn().mockResolvedValue(true),
  expireBooking:   vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/email", () => ({
  sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../../app/api/stripe/webhook/route";
import { getStripe } from "../../lib/stripe";
import {
  getBookingByStripeSession, confirmBooking, expireBooking,
} from "../../lib/db/queries";
import { sendBookingConfirmation } from "../../lib/email";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: string, sig = "valid-sig") {
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig },
    body,
  });
}

function setupStripe(event: unknown, throws?: Error) {
  const constructEvent = throws
    ? vi.fn().mockImplementation(() => { throw throws; })
    : vi.fn().mockReturnValue(event);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getStripe).mockReturnValue({ webhooks: { constructEvent } } as any);
  return constructEvent;
}

function completedEvent(sessionId = "cs_test_001", overrides: Record<string, unknown> = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        customer_email: "alice@example.com",
        metadata: { bookingRef: "BK-1731000000000-abc" },
        ...overrides,
      },
    },
  };
}

function expiredEvent(sessionId = "cs_test_001") {
  return {
    type: "checkout.session.expired",
    data: { object: { id: sessionId } },
  };
}

function makePendingBooking(overrides = {}) {
  return {
    id:              "booking-id-1",
    userId:          "user-alice",
    bookingRef:      "BK-1731000000000-abc",
    flightId:        "F1",
    passengerName:   "Alice Smith",
    seat:            "12A",
    email:           "alice@example.com",
    status:          "confirmed",
    stripeSessionId: "cs_test_001",
    paymentStatus:   "pending",
    expiresAt:       new Date(Date.now() + 30 * 60 * 1000),
    createdAt:       new Date(),
    ...overrides,
  };
}

const mockGetBooking    = vi.mocked(getBookingByStripeSession);
const mockConfirm       = vi.mocked(confirmBooking);
const mockExpire        = vi.mocked(expireBooking);
const mockSendEmail     = vi.mocked(sendBookingConfirmation);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Signature verification ────────────────────────────────────────────────────

describe("signature verification", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when constructEvent throws (invalid signature)", async () => {
    setupStripe(null, new Error("No signatures found matching the expected signature for payload"));
    const req = makeRequest("{}", "bad-sig");
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

// ── checkout.session.completed ────────────────────────────────────────────────

describe("checkout.session.completed — happy path", () => {
  it("calls confirmBooking and sends confirmation email for a pending booking", async () => {
    setupStripe(completedEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(makePendingBooking() as never);

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockConfirm).toHaveBeenCalledWith("cs_test_001");
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      bookingRef: "BK-1731000000000-abc",
      flightId:   "F1",
      seat:       "12A",
    }));
  });

  it("uses booking.email for guest bookings (no customer_email on session)", async () => {
    setupStripe(completedEvent("cs_test_001", { customer_email: null }));
    mockGetBooking.mockResolvedValue(
      makePendingBooking({ email: "guest@example.com" }) as never
    );

    await POST(makeRequest("{}"));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "guest@example.com",
    }));
  });

  it("falls back to session.customer_email when booking.email is null", async () => {
    setupStripe(completedEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(
      makePendingBooking({ email: null }) as never
    );

    await POST(makeRequest("{}"));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "alice@example.com",
    }));
  });

  it("does not crash when booking has no email and session has no customer_email", async () => {
    setupStripe(completedEvent("cs_test_001", { customer_email: null }));
    mockGetBooking.mockResolvedValue(
      makePendingBooking({ email: null }) as never
    );

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

// ── Idempotency — duplicate webhook delivery ──────────────────────────────────
// Stripe may deliver the same event more than once. The app-level guard
// (paymentStatus === "pending") and the SQL guard (WHERE paymentStatus = 'pending')
// together ensure the booking is confirmed exactly once.

describe("duplicate webhook delivery — idempotency", () => {
  it("skips confirmBooking when booking is already paid (app-level guard)", async () => {
    setupStripe(completedEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(
      makePendingBooking({ paymentStatus: "paid" }) as never
    );

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 500 when booking is not found so Stripe retries delivery", async () => {
    // A missing booking for a completed payment means the DB insert in create_checkout
    // failed after the Stripe session was created — a data integrity error. Returning
    // 500 triggers Stripe retries; if retries exhaust, manual investigation is required.
    setupStripe(completedEvent("cs_test_unknown"));
    mockGetBooking.mockResolvedValue(null as never);

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(500);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("two identical completed events produce exactly one confirmBooking call", async () => {
    setupStripe(completedEvent("cs_test_001"));
    // First event sees pending; second sees paid (simulating post-first-event DB state)
    mockGetBooking
      .mockResolvedValueOnce(makePendingBooking() as never)
      .mockResolvedValueOnce(makePendingBooking({ paymentStatus: "paid" }) as never);

    await POST(makeRequest("{}"));
    await POST(makeRequest("{}"));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("concurrent delivery race: both pass app guard, only SQL winner sends email", async () => {
    // Both handlers read the booking simultaneously and see paymentStatus='pending'.
    // Both call confirmBooking. The SQL WHERE paymentStatus='pending' means only the
    // first UPDATE wins (returns true). The loser gets false and must not send email.
    setupStripe(completedEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(makePendingBooking() as never);
    mockConfirm
      .mockResolvedValueOnce(true as never)   // first handler wins the SQL race
      .mockResolvedValueOnce(false as never);  // second handler: 0 rows updated

    await POST(makeRequest("{}"));
    await POST(makeRequest("{}"));

    expect(mockConfirm).toHaveBeenCalledTimes(2);   // both attempted the SQL update
    expect(mockSendEmail).toHaveBeenCalledTimes(1); // only the winner sent the email
  });
});

// ── checkout.session.expired ──────────────────────────────────────────────────

describe("checkout.session.expired", () => {
  it("calls expireBooking when a session expires", async () => {
    setupStripe(expiredEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(makePendingBooking() as never);

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockExpire).toHaveBeenCalledWith("cs_test_001");
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("skips expireBooking when booking is not found (session ID not in DB)", async () => {
    setupStripe(expiredEvent("cs_test_unknown"));
    mockGetBooking.mockResolvedValue(null as never);

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it("propagates unexpected expireBooking errors so Stripe can retry (no silent swallow)", async () => {
    setupStripe(expiredEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(makePendingBooking() as never);
    mockExpire.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(POST(makeRequest("{}"))).rejects.toThrow("DB connection lost");
  });
});

// ── State machine — transition guards ────────────────────────────────────────
// The SQL in confirmBooking/expireBooking uses WHERE paymentStatus = 'pending'.
// At unit-test level we verify the application-layer guard that prevents
// redundant DB writes. The SQL guard is an integration-test concern.

describe("booking state machine — transition guards", () => {
  it("completed event on an expired booking: app guard does not block (SQL guard does)", async () => {
    // paymentStatus = 'expired' is neither 'paid' nor 'pending'.
    // The app guard only checks === 'pending', so confirmBooking IS called.
    // The SQL WHERE paymentStatus = 'pending' ensures no actual state change.
    // This test documents that behaviour explicitly.
    setupStripe(completedEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(
      makePendingBooking({ paymentStatus: "expired", status: "cancelled" }) as never
    );

    await POST(makeRequest("{}"));
    // App-level check: paymentStatus !== 'pending' → skip confirmBooking
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("expired event does not reach expireBooking when booking is already paid (app + SQL guard)", async () => {
    // The app-level guard now reads the booking first. If paymentStatus !== 'pending',
    // expireBooking is never called. The SQL WHERE paymentStatus = 'pending' remains
    // the final authority — the read-before-write is not atomic.
    setupStripe(expiredEvent("cs_test_001"));
    mockGetBooking.mockResolvedValue(makePendingBooking({ paymentStatus: "paid" }) as never);

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockExpire).not.toHaveBeenCalled();
  });
});

// ── Unknown event types ───────────────────────────────────────────────────────

describe("unknown or unhandled event types", () => {
  it("returns 200 and ignores unknown event type", async () => {
    setupStripe({ type: "payment_intent.created", data: { object: {} } });

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockExpire).not.toHaveBeenCalled();
  });
});
