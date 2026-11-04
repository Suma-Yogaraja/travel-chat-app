import { describe, it, expect, beforeEach } from "vitest";
import { MockProvider } from "../../lib/flight-provider/mock-provider";

// Layer 1: pure function tests — no LLM, no API calls, instant and free

let provider: MockProvider;

beforeEach(() => {
  // Fresh provider for each test — in-memory store is reset
  provider = new MockProvider();
});

// --- searchFlights ---

describe("searchFlights", () => {
  it("returns flights matching origin and destination", async () => {
    const results = await provider.searchFlights({ origin: "JFK", destination: "LAX", date: "2026-11-05" });
    expect(results.length).toBeGreaterThan(0);
    results.forEach(f => {
      expect(f.origin).toBe("JFK");
      expect(f.destination).toBe("LAX");
    });
  });

  it("returns empty array when no flights match", async () => {
    const results = await provider.searchFlights({ origin: "JFK", destination: "XXX", date: "2026-11-05" });
    expect(results).toEqual([]);
  });

  it("is case-insensitive for airport codes", async () => {
    const upper = await provider.searchFlights({ origin: "JFK", destination: "LAX", date: "2026-11-05" });
    const lower = await provider.searchFlights({ origin: "jfk", destination: "lax", date: "2026-11-05" });
    expect(lower.length).toBe(upper.length);
  });
});

// --- getFlightSeats ---

describe("getFlightSeats", () => {
  it("returns a seat map with available and taken seats", async () => {
    const seats = await provider.getFlightSeats("F1");
    expect(seats.length).toBe(60); // 10 rows × 6 columns
    const available = seats.filter(s => s.available);
    const taken = seats.filter(s => !s.available);
    expect(available.length).toBeGreaterThan(0);
    expect(taken.length).toBeGreaterThan(0);
  });

  it("throws for unknown flight ID", async () => {
    await expect(provider.getFlightSeats("UNKNOWN")).rejects.toThrow("not found");
  });
});

// --- bookFlight ---

describe("bookFlight", () => {
  it("creates a booking and returns a booking ID", async () => {
    const booking = await provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "10A" });
    expect(booking.bookingId).toMatch(/^BK-/);
    expect(booking.seat).toBe("10A");
    expect(booking.passengerName).toBe("Suma");
    expect(booking.status).toBe("confirmed");
  });

  it("throws when the seat is already taken", async () => {
    // 1A is hardcoded as taken in F1
    await expect(
      provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "1A" })
    ).rejects.toThrow("not available");
  });

  it("throws for an invalid seat number", async () => {
    await expect(
      provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "99Z" })
    ).rejects.toThrow("does not exist");
  });

  it("throws for an unknown flight", async () => {
    await expect(
      provider.bookFlight({ flightId: "FAKE", passengerName: "Suma", seatNumber: "1A" })
    ).rejects.toThrow("not found");
  });
});

// --- getBooking ---

describe("getBooking", () => {
  it("retrieves a booking by ID", async () => {
    const created = await provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "10F" });
    const fetched = await provider.getBooking(created.bookingId);
    expect(fetched.bookingId).toBe(created.bookingId);
    expect(fetched.seat).toBe("10F");
  });

  it("throws for an unknown booking ID", async () => {
    await expect(provider.getBooking("BK-9999")).rejects.toThrow("not found");
  });
});

// --- date validation (MCP layer) ---

describe("search_flights date guard", () => {
  it("mock provider itself accepts any date (date guard lives in MCP layer)", async () => {
    // The mock provider ignores date — it matches only on origin/destination.
    // Past-date rejection happens in the MCP server handler, not here.
    const results = await provider.searchFlights({ origin: "JFK", destination: "LAX", date: "1994-01-01" });
    expect(Array.isArray(results)).toBe(true);
  });
});

// --- changeSeat ---

describe("changeSeat", () => {
  it("updates the seat on an existing booking", async () => {
    const booking = await provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "10A" });
    const updated = await provider.changeSeat({ bookingId: booking.bookingId, newSeat: "10C" });
    expect(updated.seat).toBe("10C");
    expect(updated.bookingId).toBe(booking.bookingId);
  });

  it("throws when the new seat is already taken", async () => {
    const booking = await provider.bookFlight({ flightId: "F1", passengerName: "Suma", seatNumber: "10A" });
    await expect(
      provider.changeSeat({ bookingId: booking.bookingId, newSeat: "1A" }) // hardcoded taken
    ).rejects.toThrow("not available");
  });

  it("throws for an invalid booking ID", async () => {
    await expect(
      provider.changeSeat({ bookingId: "BK-FAKE", newSeat: "5C" })
    ).rejects.toThrow("not found");
  });
});
