import { createHmac, timingSafeEqual } from "crypto";

// HMAC-SHA256 token that binds a price-change acceptance to a specific offer,
// validated price, currency, and user identity. Prevents the model from fabricating
// or replaying acceptance across different offers, users, or time windows.

export interface PriceChangePayload {
  offerId:    string;
  priceMinor: number;
  currency:   string;
  userId:     string | null; // null for guests
  exp:        number;        // unix ms
}

function hmacSecret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required for price confirmation tokens");
  return s;
}

// Default TTL: 10 minutes — enough to confirm a price change, short enough to limit replay window.
export function generatePriceChangeToken(
  params: Omit<PriceChangePayload, "exp">,
  ttlMs = 10 * 60 * 1000,
): string {
  const payload: PriceChangePayload = { ...params, exp: Date.now() + ttlMs };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = createHmac("sha256", hmacSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export type VerifyTokenResult =
  | { valid: true;  payload: PriceChangePayload }
  | { valid: false; reason: "malformed" | "invalid_signature" | "expired" | "claim_mismatch" };

export function verifyPriceChangeToken(
  token: string,
  expected: Omit<PriceChangePayload, "exp">,
): VerifyTokenResult {
  // Split on the LAST dot — the base64url payload itself cannot contain "."
  // but we guard against multi-dot strings from malformed input
  const dot = token.lastIndexOf(".");
  if (dot === -1) return { valid: false, reason: "malformed" };

  const b64 = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  if (!b64 || !sig) return { valid: false, reason: "malformed" };

  // Timing-safe signature comparison — prevents length-extension side channels
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(
      createHmac("sha256", hmacSecret()).update(b64).digest("base64url"),
      "base64url",
    );
    providedBuf = Buffer.from(sig, "base64url");
  } catch {
    return { valid: false, reason: "invalid_signature" };
  }

  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: "invalid_signature" };
  }

  // Decode and validate claims
  let payload: PriceChangePayload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf-8"));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
    return { valid: false, reason: "expired" };
  }

  if (
    payload.offerId    !== expected.offerId    ||
    payload.priceMinor !== expected.priceMinor ||
    payload.currency   !== expected.currency   ||
    payload.userId     !== expected.userId
  ) {
    return { valid: false, reason: "claim_mismatch" };
  }

  return { valid: true, payload };
}
