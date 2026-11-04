import Stripe from "stripe";

// Lazy singleton — initialized on first call, not at import time.
// This keeps test imports from blowing up when STRIPE_SECRET_KEY is absent.
let _instance: Stripe | null = null;

function getStripeClient(): Stripe {
  if (_instance) return _instance;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  if (key.startsWith("sk_live_") && process.env.NODE_ENV !== "production") {
    throw new Error("Live Stripe key detected outside production. Remove it from .env.local.");
  }

  _instance = new Stripe(key, { apiVersion: "2026-10-28.endive" });
  return _instance;
}

// --- Circuit breaker ---
// Opens after CB_THRESHOLD consecutive failures.
// Stays open for CB_TIMEOUT_MS, then moves to half-open for one test call.
const CB_THRESHOLD = 3;
const CB_TIMEOUT_MS = 60_000;
let cbFailures = 0;
let cbOpenedAt: number | null = null;
let cbState: "closed" | "open" | "half-open" = "closed";

// withStripe injects the Stripe client and handles circuit-breaker state.
// Use this for every Stripe API call — never call getStripeClient() directly.
export async function withStripe<T>(fn: (stripe: Stripe) => Promise<T>): Promise<T> {
  if (cbState === "open") {
    if (Date.now() - (cbOpenedAt ?? 0) > CB_TIMEOUT_MS) {
      cbState = "half-open";
    } else {
      throw new Error("Payment service temporarily unavailable. Please try again in a minute.");
    }
  }

  const stripe = getStripeClient();

  try {
    const result = await fn(stripe);
    cbFailures = 0;
    cbState = "closed";
    return result;
  } catch (err) {
    cbFailures++;
    if (cbFailures >= CB_THRESHOLD || cbState === "half-open") {
      cbState = "open";
      cbOpenedAt = Date.now();
    }
    throw err;
  }
}

// Direct client access for webhook signature verification (no circuit breaker needed there).
export function getStripe(): Stripe {
  return getStripeClient();
}
