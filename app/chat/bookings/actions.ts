"use server";

import { auth } from "@/lib/auth";
import { cancelBooking, getBookingByRef } from "@/lib/db/queries";
import { sendCancellationConfirmation } from "@/lib/email";
import { revalidatePath } from "next/cache";

export async function cancelBookingAction(bookingRef: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const booking = await getBookingByRef(bookingRef, session.user.id);
  if (!booking) throw new Error("Booking not found");

  await cancelBooking(bookingRef, session.user.id);
  revalidatePath("/chat/bookings");

  if (session.user.email) {
    sendCancellationConfirmation({
      to: session.user.email,
      passengerName: booking.passengerName,
      bookingRef,
      flightId: booking.flightId,
      seat: booking.seat,
    }).catch(() => {});
  }
}
