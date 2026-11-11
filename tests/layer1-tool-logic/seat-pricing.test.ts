import { describe, it, expect } from "vitest";
import { mockSeatSurchargeMinor } from "../../lib/seat-pricing";

// Layer 1: pure function tests — no DB, no network, instant

describe("mockSeatSurchargeMinor", () => {
  // ── Window seats ────────────────────────────────────────────────────────────
  it("front window (1A): +$20 front + +$30 window = $50", () => {
    expect(mockSeatSurchargeMinor("1A")).toBe(5000);
  });

  it("row 5 window (5F): still counts as front row", () => {
    expect(mockSeatSurchargeMinor("5F")).toBe(5000);
  });

  it("non-front window (6A): $30 window only", () => {
    expect(mockSeatSurchargeMinor("6A")).toBe(3000);
  });

  it("non-front window (20F): $30 window only", () => {
    expect(mockSeatSurchargeMinor("20F")).toBe(3000);
  });

  // ── Aisle seats ─────────────────────────────────────────────────────────────
  it("front aisle (1C): +$20 front + +$15 aisle = $35", () => {
    expect(mockSeatSurchargeMinor("1C")).toBe(3500);
  });

  it("front aisle (3D): +$20 front + +$15 aisle = $35", () => {
    expect(mockSeatSurchargeMinor("3D")).toBe(3500);
  });

  it("non-front aisle (6C): $15 aisle only", () => {
    expect(mockSeatSurchargeMinor("6C")).toBe(1500);
  });

  it("non-front aisle (10D): $15 aisle only", () => {
    expect(mockSeatSurchargeMinor("10D")).toBe(1500);
  });

  // ── Middle seats ─────────────────────────────────────────────────────────────
  it("front middle (2B): +$20 front only", () => {
    expect(mockSeatSurchargeMinor("2B")).toBe(2000);
  });

  it("front middle (4E): +$20 front only", () => {
    expect(mockSeatSurchargeMinor("4E")).toBe(2000);
  });

  it("non-front middle (7B): free", () => {
    expect(mockSeatSurchargeMinor("7B")).toBe(0);
  });

  it("non-front middle (15E): free", () => {
    expect(mockSeatSurchargeMinor("15E")).toBe(0);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────
  it("row 5 is still a front row (boundary)", () => {
    expect(mockSeatSurchargeMinor("5B")).toBe(2000);
  });

  it("row 6 is not a front row (boundary)", () => {
    expect(mockSeatSurchargeMinor("6B")).toBe(0);
  });

  it("invalid seat number returns 0", () => {
    expect(mockSeatSurchargeMinor("bad")).toBe(0);
    expect(mockSeatSurchargeMinor("")).toBe(0);
    expect(mockSeatSurchargeMinor("ABC")).toBe(0);
  });

  it("lowercase column is handled", () => {
    expect(mockSeatSurchargeMinor("1a")).toBe(5000);
    expect(mockSeatSurchargeMinor("6c")).toBe(1500);
  });
});
