import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Offer ID retention ────────────────────────────────────────────────────────
// If this logic drops offer IDs, the booking flow silently breaks: Claude
// cannot pass offerId to create_checkout in a later turn.

import { searchFlightsPlaceholder } from "../../lib/chat-history";

describe("searchFlightsPlaceholder — offer ID retention", () => {
  it("extracts offer IDs from flight results", () => {
    const flights = [
      { id: "F1", offerId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", price: 199.99 },
      { id: "F2", offerId: "b1ccdc00-ac1c-5fg9-cc7e-7cc0ce491b22", price: 249.99 },
    ];
    const result = searchFlightsPlaceholder(flights);
    expect(result).toContain("F1=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
    expect(result).toContain("F2=b1ccdc00-ac1c-5fg9-cc7e-7cc0ce491b22");
  });

  it("omits flights that have no offerId (graceful degrade — persist failed)", () => {
    const flights = [
      { id: "F1", offerId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" },
      { id: "F2" }, // persist failed — no offerId
    ];
    const result = searchFlightsPlaceholder(flights);
    expect(result).toContain("F1=a0eebc99");
    expect(result).not.toContain("F2=");
  });

  it("returns fallback when no flights have offerIds", () => {
    const flights = [{ id: "F1", price: 199.99 }, { id: "F2" }];
    const result = searchFlightsPlaceholder(flights);
    expect(result).toBe("[Flight results already shown to user]");
  });

  it("returns fallback for empty array", () => {
    expect(searchFlightsPlaceholder([])).toBe("[Flight results already shown to user]");
  });

  it("returns fallback for non-array output (error response from provider)", () => {
    expect(searchFlightsPlaceholder({ error: "No flights" })).toBe(
      "[Flight results already shown to user]"
    );
  });

  it("placeholder does not carry full flight payload (token budget guard)", () => {
    const flights = [{
      id: "F1",
      offerId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      origin: "JFK", destination: "LAX", date: "2026-11-05",
      departureTime: "08:00", arrivalTime: "11:30",
      price: 199.99, currency: "USD",
      airline: "United", flightNumber: "UA123",
    }];
    const result = searchFlightsPlaceholder(flights);
    // Placeholder must not leak the full object back into model context
    expect(result).not.toContain("departureTime");
    expect(result).not.toContain("flightNumber");
    expect(result).not.toContain("199.99");
  });
});

// ── Booking status pure function ──────────────────────────────────────────────

import { getBookingPaymentStatus } from "../../lib/booking-status";

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id:              "booking-id-1",
    userId:          "user-alice",
    bookingRef:      "BK-1731000000000-abc",
    flightId:        "F1",
    passengerName:   "Alice Smith",
    seat:            "12A",
    email:           null,
    status:          "confirmed",
    stripeSessionId: "cs_test_abc",
    paymentStatus:   "paid",
    expiresAt:       null,
    createdAt:       new Date("2026-11-04T10:00:00Z"),
    ...overrides,
  };
}

describe("getBookingPaymentStatus", () => {
  it("maps paid booking to correct response shape", () => {
    const result = getBookingPaymentStatus(makeBooking() as never);
    expect(result.paymentStatus).toBe("paid");
    expect(result.bookingRef).toBe("BK-1731000000000-abc");
    expect(result.flightId).toBe("F1");
    expect(result.seat).toBe("12A");
    expect(result.passengerName).toBe("Alice Smith");
    expect(result.createdAt).toBe("2026-11-04T10:00:00.000Z");
    expect(result.expiresAt).toBeNull();
  });

  it("maps pending booking with expiresAt", () => {
    const expiresAt = new Date("2026-11-04T10:30:00Z");
    const result = getBookingPaymentStatus(
      makeBooking({ paymentStatus: "pending", status: "pending", expiresAt }) as never
    );
    expect(result.paymentStatus).toBe("pending");
    expect(result.expiresAt).toBe("2026-11-04T10:30:00.000Z");
  });

  it("maps expired booking", () => {
    const result = getBookingPaymentStatus(
      makeBooking({ paymentStatus: "expired", status: "cancelled" }) as never
    );
    expect(result.paymentStatus).toBe("expired");
  });

  it("defaults paymentStatus to pending when null", () => {
    const result = getBookingPaymentStatus(makeBooking({ paymentStatus: null }) as never);
    expect(result.paymentStatus).toBe("pending");
  });
});

// ── Simulated-booking disclaimer — email templates ────────────────────────────
// The app simulates the airline booking side: Stripe payment succeeds, but no
// real airline reservation is issued. This disclaimer must appear in every
// confirmation email so users are not misled.

// vi.mock is hoisted before variable declarations — use vi.hoisted to define
// mockSendMail before the mock factory captures it.
const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({}),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

import {
  sendBookingConfirmation,
  sendSeatChangeConfirmation,
  sendCancellationConfirmation,
} from "../../lib/email";

const BASE_BOOKING = {
  to:            "alice@example.com",
  passengerName: "Alice Smith",
  bookingRef:    "BK-1731000000000-abc",
  flightId:      "F1",
  seat:          "12A",
};

beforeEach(() => {
  mockSendMail.mockClear();
});

describe("simulated-booking disclaimer in email templates", () => {
  it("booking confirmation email contains the simulated-booking disclaimer", async () => {
    await sendBookingConfirmation(BASE_BOOKING);
    const call = mockSendMail.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.html).toContain("No real flight has been booked");
  });

  it("seat change email contains the simulated-booking disclaimer", async () => {
    await sendSeatChangeConfirmation({ ...BASE_BOOKING, oldSeat: "12A", newSeat: "15C" });
    const call = mockSendMail.mock.calls[0]?.[0];
    expect(call.html).toContain("No real flight has been booked");
  });

  it("cancellation email contains the simulated-booking disclaimer", async () => {
    await sendCancellationConfirmation(BASE_BOOKING);
    const call = mockSendMail.mock.calls[0]?.[0];
    expect(call.html).toContain("No real flight has been booked");
  });

  it("booking confirmation email subject includes the booking ref", async () => {
    await sendBookingConfirmation(BASE_BOOKING);
    const call = mockSendMail.mock.calls[0]?.[0];
    expect(call.subject).toContain("BK-1731000000000-abc");
  });
});
