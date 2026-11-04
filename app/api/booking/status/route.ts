import { auth } from "@/lib/auth";
import { getBookingByRef, getBookingByRefOnly } from "@/lib/db/queries";
import { getBookingPaymentStatus } from "@/lib/booking-status";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiHandler } from "@/lib/api-handler";

export const GET = apiHandler(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
  if (!checkRateLimit(ip).allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  if (!ref || typeof ref !== "string") {
    return new Response("Missing ref", { status: 400 });
  }

  const session = await auth();

  let booking;
  if (session?.user?.id) {
    // Authenticated: booking must belong to this user
    booking = await getBookingByRef(ref, session.user.id);
  } else {
    // Guest: only GS- refs are accessible as bearer credentials
    if (!ref.startsWith("GS-")) {
      return new Response("Unauthorized", { status: 403 });
    }
    booking = await getBookingByRefOnly(ref);
  }

  if (!booking) {
    // Return pending rather than 404 — the booking may not be written yet
    // (small window between create_checkout returning and DB commit)
    return new Response(
      JSON.stringify({ paymentStatus: "pending", bookingRef: ref }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }

  return new Response(
    JSON.stringify(getBookingPaymentStatus(booking)),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
});
