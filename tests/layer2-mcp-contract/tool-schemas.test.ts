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
  it("returns content array with type=text", () => {
    const flights = provider.searchFlights({ origin: "JFK", destination: "LAX", date: "2026-11-05" });
    const response = mcpText(JSON.stringify(flights, null, 2));
    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("price");
  });
});

describe("get_flight_seats tool contract", () => {
  it("returns available and taken seat arrays", () => {
    const seats = provider.getFlightSeats("F1");
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
  it("returns a booking object with bookingId", () => {
    const booking  = provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "9A" });
    const response = mcpText(JSON.stringify(booking, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed).toHaveProperty("bookingId");
    expect(parsed).toHaveProperty("seat");
    expect(parsed.status).toBe("confirmed");
  });
});

describe("get_booking tool contract", () => {
  it("returns booking details for a valid ID", () => {
    const created  = provider.bookFlight({ flightId: "F2", passengerName: "Suma", seatNumber: "9B" });
    const booking  = provider.getBooking(created.bookingId);
    const response = mcpText(JSON.stringify(booking, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.bookingId).toBe(created.bookingId);
  });
});

describe("change_seat tool contract", () => {
  it("returns updated booking with new seat", () => {
    const created  = provider.bookFlight({ flightId: "F3", passengerName: "Suma", seatNumber: "9C" });
    const updated  = provider.changeSeat({ bookingId: created.bookingId, newSeat: "9D" });
    const response = mcpText(JSON.stringify(updated, null, 2));

    expect(response.content[0].type).toBe("text");
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.seat).toBe("9D");
    expect(parsed.bookingId).toBe(created.bookingId);
  });
});

describe("tool list by user type", () => {
  it("guest tools include send_booking_otp and exclude auth-only tools", () => {
    const tools = createTravelTools(undefined);
    const keys = Object.keys(tools);
    expect(keys).toContain("send_booking_otp");
    expect(keys).toContain("book_flight");
    expect(keys).toContain("get_guest_booking");
    expect(keys).toContain("request_otp");
    expect(keys).toContain("verify_and_cancel");
    expect(keys).toContain("verify_and_change_seat");
    expect(keys).not.toContain("get_booking");
    expect(keys).not.toContain("change_seat");
  });

  it("auth tools exclude send_booking_otp and guest-only tools", () => {
    const tools = createTravelTools("user-123");
    const keys = Object.keys(tools);
    expect(keys).not.toContain("send_booking_otp");
    expect(keys).not.toContain("get_guest_booking");
    expect(keys).not.toContain("request_otp");
    expect(keys).not.toContain("verify_and_cancel");
    expect(keys).not.toContain("verify_and_change_seat");
    expect(keys).toContain("book_flight");
    expect(keys).toContain("get_booking");
    expect(keys).toContain("change_seat");
  });
});
