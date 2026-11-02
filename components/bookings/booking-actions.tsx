"use client";

import { useState } from "react";
import Link from "next/link";
import { cancelBookingAction } from "@/app/chat/bookings/actions";

interface Props {
  bookingRef: string;
  status: string;
}

export function BookingActions({ bookingRef, status }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  if (status === "cancelled") return null;

  const changeSeatUrl = `/chat?q=${encodeURIComponent(`Change my seat on booking ${bookingRef}`)}`;

  if (confirming) {
    return (
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-800">
        <span className="text-xs text-gray-400">Cancel this booking?</span>
        <button
          onClick={async () => {
            setLoading(true);
            await cancelBookingAction(bookingRef);
          }}
          disabled={loading}
          className="text-xs font-medium text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
        >
          {loading ? "Cancelling…" : "Yes, cancel"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
        >
          Keep it
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-800">
      <Link
        href={changeSeatUrl}
        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        Change seat →
      </Link>
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-red-500 hover:text-red-400 transition-colors"
      >
        Cancel booking
      </button>
    </div>
  );
}
