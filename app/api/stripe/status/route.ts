import { getBookingByStripeSession } from "@/lib/db/queries";
import { getBookingPaymentStatus } from "@/lib/booking-status";
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

  const data = getBookingPaymentStatus(booking);

  // Success page uses `status` (not `paymentStatus`) — keep that field name
  return Response.json({
    status:        data.paymentStatus,
    bookingRef:    data.bookingRef,
    flightId:      data.flightId,
    seat:          data.seat,
    passengerName: data.passengerName,
  });
});
