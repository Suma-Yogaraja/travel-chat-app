import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateOfferForCheckout } from "../../lib/offers/offer-service";

// Mocks must be declared before imports that use them.
// We mock the repository so tests never hit the real database.
vi.mock("../../lib/offers/offer-repository", () => ({
  getFlightOfferById: vi.fn(),
  insertFlightOffer:  vi.fn(),
}));

import { getFlightOfferById } from "../../lib/offers/offer-repository";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Default session used in tests that are NOT testing ownership.
// Ownership tests use their own explicit session IDs.
const DEFAULT_SESSION = "gs-session-default-0001";

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id:              "offer-uuid-1",
    provider:        "mock",
    providerOfferId: null,
    ownerUserId:     null,          // unowned by default — guest offer
    guestSessionId:  DEFAULT_SESSION, // matches DEFAULT_SESSION in context below
    origin:          "JFK",
    destination:     "LAX",
    departureAt:     new Date("2026-11-05T06:00:00Z"),
    cabinClass:      "economy",
    segments:        {},
    priceMinor:      19999,
    currency:        "USD",
    expiresAt:       new Date(Date.now() + 30 * 60 * 1000), // 30 min from now
    createdAt:       new Date(),
    ...overrides,
  };
}

const mockGetOffer = vi.mocked(getFlightOfferById);

beforeEach(() => {
  vi.clearAllMocks();
  // Default Duffel fetch: not used unless provider = "duffel"
  vi.stubGlobal("fetch", vi.fn());
});

// ── Failure modes ─────────────────────────────────────────────────────────────

describe("offer not found", () => {
  it("returns not_found when offer does not exist", async () => {
    mockGetOffer.mockResolvedValue(null);
    const result = await validateOfferForCheckout("missing-id", {});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });
});

describe("offer expiry", () => {
  it("returns expired when offer expiresAt is in the past", async () => {
    mockGetOffer.mockResolvedValue(
      makeOffer({ expiresAt: new Date(Date.now() - 1000) }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", {});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");
  });

  it("accepts offer expiring in the future", async () => {
    mockGetOffer.mockResolvedValue(makeOffer() as never);
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(true);
  });
});

// ── Ownership invariant ────────────────────────────────────────────────────────

describe("ownership", () => {
  it("allows an auth user to access their own offer", async () => {
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: "user-alice" }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", { userId: "user-alice" });
    expect(result.valid).toBe(true);
  });

  it("rejects an auth user accessing another user's offer (not_found, not unauthorized)", async () => {
    // Returns not_found — prevents enumerating which offers exist
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: "user-alice" }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", { userId: "user-bob" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });

  it("rejects unauthenticated user accessing an owned offer", async () => {
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: "user-alice" }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", { userId: undefined });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });

});

// ── Guest session ownership ────────────────────────────────────────────────────
// ownerUserId === null means a guest offer — guestSessionId is the credential.
// The session ID comes from an HttpOnly cookie; the UUID alone is not enough.

const GUEST_SESSION = "gs-session-aaaaaaaa-0001";

describe("guest session ownership", () => {
  it("allows guest A to access their own offer (matching guestSessionId)", async () => {
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: null, guestSessionId: GUEST_SESSION }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: GUEST_SESSION });
    expect(result.valid).toBe(true);
  });

  it("rejects guest B accessing guest A's offer (session mismatch)", async () => {
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: null, guestSessionId: "gs-session-alice-0001" }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", {
      guestSessionId: "gs-session-bob-0001",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });

  it("rejects guest request with no session at all (cookie absent)", async () => {
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: null, guestSessionId: GUEST_SESSION }) as never
    );
    // No guestSessionId in context — simulates a request where the cookie was never set
    const result = await validateOfferForCheckout("offer-uuid-1", {});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });

  it("rejects authenticated user accessing a guest offer (no session in context)", async () => {
    // Auth users never carry guestSessionId — they cannot claim guest offers
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: null, guestSessionId: GUEST_SESSION }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", { userId: "user-alice" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });

  it("rejects guest whose session changed between search and checkout (stale cookie)", async () => {
    // Session at search time ≠ session at checkout — e.g. user cleared cookies mid-flow
    mockGetOffer.mockResolvedValue(
      makeOffer({ ownerUserId: null, guestSessionId: "gs-session-at-search" }) as never
    );
    const result = await validateOfferForCheckout("offer-uuid-1", {
      guestSessionId: "gs-session-at-checkout",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("not_found");
  });
});

// ── Mock provider pricing ─────────────────────────────────────────────────────

describe("mock provider — stored price trusted", () => {
  it("returns valid with priceChanged: false for mock offers", async () => {
    mockGetOffer.mockResolvedValue(makeOffer({ provider: "mock" }) as never);
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.priceChanged).toBe(false);
      expect(result.priceMinor).toBe(19999);
      expect(result.currency).toBe("USD");
    }
  });

  it("does not call Duffel for mock offers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockGetOffer.mockResolvedValue(makeOffer({ provider: "mock" }) as never);
    await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Duffel for Duffel offers without providerOfferId", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockGetOffer.mockResolvedValue(
      makeOffer({ provider: "duffel", providerOfferId: null }) as never
    );
    await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Duffel provider pricing ───────────────────────────────────────────────────

function duffelOffer(overrides: Record<string, unknown> = {}) {
  return makeOffer({
    provider:        "duffel",
    providerOfferId: "duffel-offer-abc",
    priceMinor:      19999,
    currency:        "USD",
    ...overrides,
  });
}

function mockDuffelFetch(response: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  }));
}

describe("Duffel revalidation — price unchanged", () => {
  it("returns priceChanged: false when Duffel confirms same price", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer() as never);
    mockDuffelFetch({ data: { total_amount: "199.99", total_currency: "USD" } });
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.priceChanged).toBe(false);
      expect(result.priceMinor).toBe(19999);
    }
  });
});

describe("Duffel revalidation — price increased", () => {
  it("returns priceChanged: true with new and previous amounts", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer({ priceMinor: 19999 }) as never);
    mockDuffelFetch({ data: { total_amount: "250.00", total_currency: "USD" } });
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.priceChanged).toBe(true);
      expect(result.priceMinor).toBe(25000);       // new Duffel price
      expect(result.previousPriceMinor).toBe(19999); // stored offer price
    }
  });
});

describe("Duffel revalidation — price decreased", () => {
  it("returns priceChanged: true so user is explicitly informed (not silently overcharged)", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer({ priceMinor: 25000 }) as never);
    mockDuffelFetch({ data: { total_amount: "150.00", total_currency: "USD" } });
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(true);
    if (result.valid) {
      // A price decrease is still a change — user should see the new lower price.
      // We never silently charge the old higher stored price.
      expect(result.priceChanged).toBe(true);
      expect(result.priceMinor).toBe(15000);
    }
  });
});

describe("Duffel unavailability — fail closed", () => {
  it("returns provider_unavailable when fetch throws", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer() as never);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("provider_unavailable");
  });

  it("returns provider_unavailable when Duffel returns non-ok response", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer() as never);
    mockDuffelFetch({}, false); // ok = false
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("provider_unavailable");
  });

  it("returns provider_unavailable when Duffel returns malformed pricing data", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer() as never);
    // Missing total_amount field
    mockDuffelFetch({ data: { total_currency: "USD" } });
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("provider_unavailable");
  });

  it("returns provider_unavailable when Duffel returns non-numeric amount", async () => {
    mockGetOffer.mockResolvedValue(duffelOffer() as never);
    // parseFloat("unavailable") = NaN — must be caught before reaching Stripe
    mockDuffelFetch({ data: { total_amount: "unavailable", total_currency: "USD" } });
    const result = await validateOfferForCheckout("offer-uuid-1", { guestSessionId: DEFAULT_SESSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("provider_unavailable");
  });
});

// ── Concurrent isolation ───────────────────────────────────────────────────────

describe("request isolation", () => {
  it("two concurrent requests with different users get independent results", async () => {
    // Both offers exist but belong to different users
    const aliceOffer = makeOffer({ id: "offer-alice", ownerUserId: "user-alice" });
    const bobOffer   = makeOffer({ id: "offer-bob",   ownerUserId: "user-bob" });

    mockGetOffer.mockImplementation(async (id: string) => {
      if (id === "offer-alice") return aliceOffer as never;
      if (id === "offer-bob")   return bobOffer as never;
      return null;
    });

    const [aliceResult, bobResult] = await Promise.all([
      validateOfferForCheckout("offer-alice", { userId: "user-alice" }),
      validateOfferForCheckout("offer-bob",   { userId: "user-bob" }),
    ]);

    expect(aliceResult.valid).toBe(true);
    expect(bobResult.valid).toBe(true);
  });

  it("user cannot access the other's offer when both run concurrently", async () => {
    const aliceOffer = makeOffer({ id: "offer-alice", ownerUserId: "user-alice" });
    mockGetOffer.mockResolvedValue(aliceOffer as never);

    const [aliceResult, bobResult] = await Promise.all([
      validateOfferForCheckout("offer-alice", { userId: "user-alice" }),
      validateOfferForCheckout("offer-alice", { userId: "user-bob" }),
    ]);

    expect(aliceResult.valid).toBe(true);
    expect(bobResult.valid).toBe(false);
  });
});
