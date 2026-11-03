// Simple sliding-window rate limiter — in-memory, per-process.
// On multi-instance deployments (Vercel) each instance has its own counter,
// so the effective limit is MAX_REQUESTS per instance per window, not globally.
// Good enough for a hobby project; swap to Upstash Rate Limit for true global limiting.

const store = new Map<string, number[]>();

const WINDOW_MS = 60_000;   // 1 minute
const MAX_REQUESTS = 20;    // 20 chat turns per minute per IP

export function checkRateLimit(identifier: string): { allowed: boolean } {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Prune IPs with no recent activity to prevent unbounded Map growth
  if (store.size > 500) {
    for (const [key, ts] of store) {
      if (ts[ts.length - 1] < windowStart) store.delete(key);
    }
  }

  const timestamps = (store.get(identifier) ?? []).filter(t => t > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    store.set(identifier, timestamps);
    return { allowed: false };
  }

  timestamps.push(now);
  store.set(identifier, timestamps);
  return { allowed: true };
}
