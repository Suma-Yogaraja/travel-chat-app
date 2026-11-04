import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getBookings } from "@/lib/db/queries";
import { BookingActions } from "@/components/bookings/booking-actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  let bookings;
  try {
    bookings = await getBookings(session.user.id);
  } catch {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto text-center py-16">
          <p className="text-sm text-red-400">Unable to load bookings. Please try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold">My Bookings</h1>
          <Link
            href="/chat"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            + New booking
          </Link>
        </div>

        {bookings.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-4xl mb-3">🎫</p>
            <p className="text-sm">No bookings yet.</p>
            <p className="text-xs mt-1 text-gray-600">
              Start a chat and ask to book a flight.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {bookings.map(b => {
              const cancelled = b.status === "cancelled";
              return (
                <li
                  key={b.id}
                  className={`rounded-xl border px-5 py-4 transition-colors ${
                    cancelled
                      ? "bg-gray-900/40 border-gray-800/50 opacity-60"
                      : "bg-gray-900 border-gray-800"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className={`text-sm font-semibold ${cancelled ? "text-gray-400" : "text-white"}`}>
                        {b.passengerName}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Flight {b.flightId} · Seat {b.seat}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${
                        cancelled
                          ? "bg-gray-800 text-gray-500"
                          : "bg-green-900/50 text-green-400"
                      }`}>
                        {b.status}
                      </span>
                      <p className="text-xs text-gray-600 mt-1 font-mono">{b.bookingRef}</p>
                    </div>
                  </div>
                  <BookingActions bookingRef={b.bookingRef} status={b.status} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
