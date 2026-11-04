import { describe, it, expect } from "vitest";
import { toMinorUnits, fromMinorUnits } from "../../lib/offers/offer-service";

// Invariant: no model-supplied value can determine the Stripe amount.
// These unit tests verify that the currency conversion layer is correct for
// all supported currency types — wrong conversions here flow directly into Stripe charges.

describe("toMinorUnits", () => {
  // ── Standard 2-decimal currencies ──────────────────────────────────────────

  it("converts USD correctly", () => {
    expect(toMinorUnits(159.99, "USD")).toBe(15999);
    expect(toMinorUnits(450.00, "USD")).toBe(45000);
    expect(toMinorUnits(0.01,  "USD")).toBe(1);
  });

  it("converts EUR correctly", () => {
    expect(toMinorUnits(99.99, "EUR")).toBe(9999);
  });

  it("rounds floating-point imprecision correctly", () => {
    // 450.25 * 100 = 45025.000000000004 in JS — must not produce 45025 or 45026 by chance
    expect(toMinorUnits(450.25, "USD")).toBe(45025);
    expect(toMinorUnits(0.1 + 0.2, "USD")).toBe(30); // 0.30000000000000004 rounds to 30
  });

  // ── Zero-decimal currencies ─────────────────────────────────────────────────

  it("converts JPY without decimal places", () => {
    // JPY has no subunit — 450 yen stays 450
    expect(toMinorUnits(450, "JPY")).toBe(450);
    expect(toMinorUnits(1000, "JPY")).toBe(1000);
  });

  it("converts KRW without decimal places", () => {
    expect(toMinorUnits(50000, "KRW")).toBe(50000);
  });

  // ── Three-decimal currencies ────────────────────────────────────────────────

  it("converts KWD to fils (3 decimal places)", () => {
    // 450.250 KWD = 450250 fils
    expect(toMinorUnits(450.250, "KWD")).toBe(450250);
    expect(toMinorUnits(1.001, "KWD")).toBe(1001);
  });

  it("converts BHD to fils correctly", () => {
    expect(toMinorUnits(10.500, "BHD")).toBe(10500);
  });

  it("converts OMR to baisa correctly", () => {
    expect(toMinorUnits(100.000, "OMR")).toBe(100000);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  it("is case-insensitive for currency codes", () => {
    expect(toMinorUnits(10, "usd")).toBe(toMinorUnits(10, "USD"));
    expect(toMinorUnits(10, "jpy")).toBe(toMinorUnits(10, "JPY"));
  });

  it("defaults to 2 decimal places for unknown currencies", () => {
    expect(toMinorUnits(10.50, "XYZ")).toBe(1050);
  });

  it("handles zero amount", () => {
    expect(toMinorUnits(0, "USD")).toBe(0);
    expect(toMinorUnits(0, "JPY")).toBe(0);
  });
});

describe("fromMinorUnits", () => {
  it("reverses USD conversion", () => {
    expect(fromMinorUnits(15999, "USD")).toBeCloseTo(159.99, 2);
    expect(fromMinorUnits(45000, "USD")).toBe(450);
  });

  it("reverses JPY conversion", () => {
    expect(fromMinorUnits(450, "JPY")).toBe(450);
  });

  it("reverses KWD conversion", () => {
    expect(fromMinorUnits(450250, "KWD")).toBeCloseTo(450.25, 3);
  });

  it("round-trips USD without accumulating error", () => {
    const original = 199.99;
    const minor = toMinorUnits(original, "USD");
    const back = fromMinorUnits(minor, "USD");
    expect(back).toBeCloseTo(original, 2);
  });

  it("round-trips JPY without introducing decimals", () => {
    expect(fromMinorUnits(toMinorUnits(5000, "JPY"), "JPY")).toBe(5000);
  });
});
