import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generatePriceChangeToken,
  verifyPriceChangeToken,
} from "../../lib/offers/price-confirmation";

// Invariant: a price-change acceptance is bound to a specific offer, validated price,
// currency, and user identity. The model cannot fabricate or replay this acceptance.

const SECRET = "test-secret-for-price-confirmation";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.NEXTAUTH_SECRET;
});

const BASE = {
  offerId:    "00000000-0000-0000-0000-000000000001",
  priceMinor: 52000,
  currency:   "USD",
  userId:     "user-alice",
} as const;

describe("generatePriceChangeToken + verifyPriceChangeToken — happy path", () => {
  it("generates a verifiable token", () => {
    const token = generatePriceChangeToken(BASE);
    const result = verifyPriceChangeToken(token, BASE);
    expect(result.valid).toBe(true);
  });

  it("token payload encodes all claim fields", () => {
    const token = generatePriceChangeToken(BASE);
    const result = verifyPriceChangeToken(token, BASE);
    if (!result.valid) throw new Error("expected valid");
    expect(result.payload.offerId).toBe(BASE.offerId);
    expect(result.payload.priceMinor).toBe(BASE.priceMinor);
    expect(result.payload.currency).toBe(BASE.currency);
    expect(result.payload.userId).toBe(BASE.userId);
    expect(typeof result.payload.exp).toBe("number");
  });

  it("works for guest users (userId: null)", () => {
    const params = { ...BASE, userId: null };
    const token  = generatePriceChangeToken(params);
    const result = verifyPriceChangeToken(token, params);
    expect(result.valid).toBe(true);
  });
});

describe("claim-mismatch rejections", () => {
  it("rejects token when offerId differs", () => {
    const token  = generatePriceChangeToken(BASE);
    const result = verifyPriceChangeToken(token, {
      ...BASE, offerId: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("claim_mismatch");
  });

  it("rejects token when priceMinor differs (model passes wrong amount)", () => {
    const token  = generatePriceChangeToken(BASE);
    // Model could try to pass the original lower price instead of the new higher one
    const result = verifyPriceChangeToken(token, { ...BASE, priceMinor: 45000 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("claim_mismatch");
  });

  it("rejects token when currency differs", () => {
    const token  = generatePriceChangeToken(BASE);
    const result = verifyPriceChangeToken(token, { ...BASE, currency: "EUR" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("claim_mismatch");
  });

  it("rejects token when userId differs (cross-user replay)", () => {
    const token  = generatePriceChangeToken(BASE);
    const result = verifyPriceChangeToken(token, { ...BASE, userId: "user-bob" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("claim_mismatch");
  });

  it("rejects Bob's token when Alice is requesting (cross-user attack)", () => {
    // Bob accepted a price change on Bob's offer — token is bound to Bob
    const bobToken = generatePriceChangeToken({ ...BASE, userId: "user-bob" });
    // Alice cannot use Bob's token even if she knows it
    const result   = verifyPriceChangeToken(bobToken, { ...BASE, userId: "user-alice" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("claim_mismatch");
  });

  it("rejects cross-offer token (token from offer A used for offer B)", () => {
    const offerA = "00000000-0000-0000-0000-00000000aaaa";
    const offerB = "00000000-0000-0000-0000-00000000bbbb";
    const tokenForA = generatePriceChangeToken({ ...BASE, offerId: offerA });
    const result    = verifyPriceChangeToken(tokenForA, { ...BASE, offerId: offerB });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("claim_mismatch");
  });
});

describe("signature rejections", () => {
  it("rejects a fabricated token (no valid signature)", () => {
    // Model tries to construct a plausible-looking token without the secret
    const fakePayload = Buffer.from(JSON.stringify({
      offerId: BASE.offerId, priceMinor: BASE.priceMinor,
      currency: BASE.currency, userId: BASE.userId,
      exp: Date.now() + 60_000,
    })).toString("base64url");
    const fakeToken = `${fakePayload}.invalidsig`;
    const result = verifyPriceChangeToken(fakeToken, BASE);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("invalid_signature");
  });

  it("rejects a token with tampered payload (signature no longer matches)", () => {
    const token = generatePriceChangeToken(BASE);
    // Flip one character in the payload section to simulate tampering
    const [b64, sig] = token.split(".");
    const tampered = b64.slice(0, -1) + (b64.endsWith("A") ? "B" : "A");
    const result = verifyPriceChangeToken(`${tampered}.${sig}`, BASE);
    expect(result.valid).toBe(false);
    // Tampered payload → signature mismatch or malformed JSON
    if (!result.valid) expect(["invalid_signature", "malformed"]).toContain(result.reason);
  });

  it("rejects token with no dot separator", () => {
    const result = verifyPriceChangeToken("nodotintoken", BASE);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("malformed");
  });

  it("rejects empty token", () => {
    const result = verifyPriceChangeToken("", BASE);
    expect(result.valid).toBe(false);
  });
});

describe("expiry", () => {
  it("rejects an already-expired token (negative TTL = already past)", () => {
    // -1ms TTL → exp = Date.now() - 1, guaranteed to be in the past
    const token  = generatePriceChangeToken(BASE, -1);
    const result = verifyPriceChangeToken(token, BASE);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("expired");
  });

  it("accepts a token with a future expiry", () => {
    const token  = generatePriceChangeToken(BASE, 60_000); // 1 minute
    const result = verifyPriceChangeToken(token, BASE);
    expect(result.valid).toBe(true);
  });
});
