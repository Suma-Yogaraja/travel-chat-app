import { randomUUID } from "crypto";

const COOKIE_NAME = "guest-session-id";
const MAX_AGE     = 86400; // 24 hours

export type GuestSession = {
  guestSessionId: string;
  setCookie?: string; // present only when a new session was just created
};

// Read the guest session cookie from an incoming request.
// If none exists, generate a new UUID and return the Set-Cookie header value.
// Never called for authenticated users — caller must gate on !userId.
export function getOrCreateGuestSession(req: Request): GuestSession {
  const existing = parseCookie(req.headers.get("cookie") ?? "", COOKIE_NAME);
  if (existing) return { guestSessionId: existing };

  const id = randomUUID();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const setCookie =
    `${COOKIE_NAME}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}${secure}`;
  return { guestSessionId: id, setCookie };
}

function parseCookie(header: string, name: string): string | null {
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    if (k === name) {
      const v = pair.slice(eq + 1).trim();
      return v || null; // treat empty string as absent
    }
  }
  return null;
}
