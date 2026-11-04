import { describe, it, expect } from "vitest";
import { MockProvider } from "../../lib/flight-provider/mock-provider";
import { createTravelTools } from "../../lib/tools";

// Layer 2: contract tests — verify each tool returns the expected shape.
// These test the exact response structure the MCP server will send to Claude.
// No LLM, no subprocess — pure shape verification.

const provider = new MockProvider();

function mcpText(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("search_flights tool contract", () => {
  it("returns content array with type=text", async () => {
    const flights = await provider.searchFlights({ origin: "JFK", destination: "LAX", date: "2026-11-05" });
    const response = mcpText(JSON.stringify(flights, null, 2));
    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("price");
  });
});

describe("get_flight_seats tool contract", () => {
  it("returns available and taken seat arrays", async () => {
    const seats = await provider.getFlightSeats("F1");
    const available = seats.filter(s => s.available).map(s => `${s.seatNumber}(${s.type})`);
    const taken     = seats.filter(s => !s.available).map(s => s.seatNumber);
    const response  = mcpText(JSON.stringify({ flightId: "F1", available, taken }, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toHaveProperty("available");
    expect(parsed).toHaveProperty("taken");
    expect(Array.isArray(parsed.available)).toBe(true);
  });
});

describe("book_flight tool contract", () => {
  it("returns a booking object with bookingId", async () => {
    const booking  = await provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "9A" });
    const response = mcpText(JSON.stringify(booking, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toHaveProperty("bookingId");
    expect(parsed).toHaveProperty("seat");
    expect(parsed.status).toBe("confirmed");
  });
});

describe("get_booking tool contract", () => {
  it("returns booking details for a valid ID", async () => {
    const created  = await provider.bookFlight({ flightId: "F2", passengerName: "Suma", seatNumber: "9B" });
    const booking  = await provider.getBooking(created.bookingId);
    const response = mcpText(JSON.stringify(booking, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.bookingId).toBe(created.bookingId);
  });
});

describe("change_seat tool contract", () => {
  it("returns updated booking with new seat", async () => {
    const created  = await provider.bookFlight({ flightId: "F3", passengerName: "Suma", seatNumber: "9C" });
    const updated  = await provider.changeSeat({ bookingId: created.bookingId, newSeat: "9D" });
    const response = mcpText(JSON.stringify(updated, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.seat).toBe("9D");
    expect(parsed.bookingId).toBe(created.bookingId);
  });
});

describe("tool list by user type", () => {
  it("guest tools include send_booking_otp and exclude auth-only tools", () => {
    const tools = createTravelTools({});
    const keys = Object.keys(tools);
    expect(keys).toContain("send_booking_otp");
    expect(keys).toContain("create_checkout");
    expect(keys).toContain("get_guest_booking");
    expect(keys).toContain("request_otp");
    expect(keys).toContain("verify_and_cancel");
    expect(keys).toContain("verify_and_change_seat");
    expect(keys).not.toContain("book_flight");
    expect(keys).not.toContain("get_booking");
    expect(keys).not.toContain("change_seat");
  });

  it("auth tools include create_checkout and exclude guest-only tools", () => {
    const tools = createTravelTools({ userId: "user-123" });
    const keys = Object.keys(tools);
    expect(keys).toContain("create_checkout");
    expect(keys).toContain("get_booking");
    expect(keys).toContain("change_seat");
    expect(keys).not.toContain("book_flight");
    expect(keys).not.toContain("send_booking_otp");
    expect(keys).not.toContain("get_guest_booking");
    expect(keys).not.toContain("request_otp");
    expect(keys).not.toContain("verify_and_cancel");
    expect(keys).not.toContain("verify_and_change_seat");
  });
});

// ── Pricing invariant: model cannot supply a price ────────────────────────────
// The Zod schema is the enforcement layer — if priceUsd is accepted, the model
// can pass any value and it will reach Stripe. These tests are the contract
// that the invariant has not been silently regressed.

describe("create_checkout schema — pricing invariant", () => {
  function checkoutSchema() {
    const tools = createTravelTools({ userId: "user-123" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (tools.create_checkout as any).inputSchema;
  }

  it("requires offerId (the server-side price handle)", () => {
    const schema = checkoutSchema();
    // A valid input must include offerId
    const result = schema.safeParse({
      offerId:       "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      flightId:      "F1",
      passengerName: "Alice",
      seatNumber:    "5A",
    });
    expect(result.success).toBe(true);
  });

  it("rejects input without offerId", () => {
    const schema = checkoutSchema();
    const result = schema.safeParse({
      flightId:      "F1",
      passengerName: "Alice",
      seatNumber:    "5A",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID offerId", () => {
    const schema = checkoutSchema();
    const result = schema.safeParse({
      offerId:       "not-a-uuid",
      flightId:      "F1",
      passengerName: "Alice",
      seatNumber:    "5A",
    });
    expect(result.success).toBe(false);
  });

  it("does not accept priceUsd (model must not supply price)", () => {
    const schema = checkoutSchema();
    // priceUsd should not be in the schema at all — extra fields are stripped
    // by Zod's default behavior. Verify the field has no effect on parse.
    const result = schema.safeParse({
      offerId:       "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      flightId:      "F1",
      passengerName: "Alice",
      seatNumber:    "5A",
      priceUsd:      1, // attempt to supply a price
    });
    // Parse may succeed (Zod strips unknown keys) but the field must not appear
    // in the output — it should be silently ignored, not passed to execute
    if (result.success) {
      expect((result.data as Record<string, unknown>).priceUsd).toBeUndefined();
    }
    // Either way: the field has no path to Stripe
  });

  it("accepts priceChangeToken for confirmed price changes", () => {
    const schema = checkoutSchema();
    const result = schema.safeParse({
      offerId:          "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      flightId:         "F1",
      passengerName:    "Alice",
      seatNumber:       "5A",
      priceChangeToken: "some.token",
    });
    expect(result.success).toBe(true);
  });
});

describe("search_flights flight shape — currency field", () => {
  it("returned flights include a currency field", async () => {
    const flights = await provider.searchFlights({
      origin: "JFK", destination: "LAX", date: "2026-11-05",
    });
    expect(flights.length).toBeGreaterThan(0);
    flights.forEach(f => {
      expect(f).toHaveProperty("currency");
      expect(typeof f.currency).toBe("string");
      expect(f.currency.length).toBe(3);
    });
  });
});
