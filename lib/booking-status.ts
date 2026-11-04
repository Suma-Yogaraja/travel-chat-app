import type { bookings } from "./db/schema";
import type { InferSelectModel } from "drizzle-orm";

type Booking = InferSelectModel<typeof bookings>;

export interface BookingStatusResponse {
  paymentStatus: "pending" | "paid" | "expired" | "failed";
  bookingRef: string;
  flightId: string;
  seat: string;
  passengerName: string;
  createdAt: string | null;
  expiresAt: string | null;
}

export function getBookingPaymentStatus(booking: Booking): BookingStatusResponse {
  return {
    paymentStatus: (booking.paymentStatus ?? "pending") as BookingStatusResponse["paymentStatus"],
    bookingRef:    booking.bookingRef,
    flightId:      booking.flightId,
    seat:          booking.seat,
    passengerName: booking.passengerName,
    createdAt:     booking.createdAt?.toISOString() ?? null,
    expiresAt:     booking.expiresAt?.toISOString() ?? null,
  };
}
