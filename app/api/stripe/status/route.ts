import { getBookingByStripeSession } from "@/lib/db/queries";
import { auth } from "@/lib/auth";
import { apiHandler } from "@/lib/api-handler";

export const GET = apiHandler(async (req: Request) => {
  const session = await auth();
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) return new Response("Missing session_id", { status: 400 });

  const booking = await getBookingByStripeSession(sessionId);
  if (!booking) return Response.json({ status: "pending" });

  // Auth users can only see their own bookings
  if (session?.user?.id && booking.userId !== session.user.id) {
    return new Response("Unauthorized", { status: 403 });
  }

  return Response.json({
    status: booking.paymentStatus,
    bookingRef: booking.bookingRef,
    flightId: booking.flightId,
    seat: booking.seat,
    passengerName: booking.passengerName,
  });
});
