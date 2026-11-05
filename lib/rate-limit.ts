// Simple sliding-window rate limiter — in-memory, per-process.
// On multi-instance deployments (Vercel) each instance has its own counter,
// so the effective limit is maxRequests per instance per window, not globally.
// Good enough for a hobby project; swap to Upstash Rate Limit for true global limiting.

const store = new Map<string, number[]>();

// Defaults used by the chat route — auth routes pass stricter values.
const DEFAULT_WINDOW_MS   = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 20;    // 20 chat turns per minute per IP

export function checkRateLimit(
  identifier: string,
  opts?: { maxRequests?: number; windowMs?: number },
): { allowed: boolean } {
  const maxRequests = opts?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs    = opts?.windowMs    ?? DEFAULT_WINDOW_MS;
  const now         = Date.now();
  const windowStart = now - windowMs;

  // Prune stale entries to prevent unbounded Map growth
  if (store.size > 500) {
    for (const [key, ts] of store) {
      if (ts[ts.length - 1] < windowStart) store.delete(key);
    }
  }

  const timestamps = (store.get(identifier) ?? []).filter(t => t > windowStart);

  if (timestamps.length >= maxRequests) {
    store.set(identifier, timestamps);
    return { allowed: false };
  }

  timestamps.push(now);
  store.set(identifier, timestamps);
  return { allowed: true };
}
