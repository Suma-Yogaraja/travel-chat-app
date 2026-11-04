"use client";

import { useState } from "react";

interface PayButtonProps {
  checkoutUrl: string;
  priceUsd: number;
  bookingRef: string;
  flightId: string;
  seatNumber: string;
  passengerName: string;
}

export function PayButton({ checkoutUrl, priceUsd, bookingRef, flightId, seatNumber, passengerName }: PayButtonProps) {
  const [loading, setLoading] = useState(false);

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "#0d1f33", border: "1px solid #1e3a5f" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">
            Flight {flightId} · Seat {seatNumber}
          </p>
          <p className="text-[#6b8caa] text-xs mt-0.5 truncate">{passengerName}</p>
          <p className="text-[#444] text-xs mt-1 font-mono">{bookingRef}</p>
        </div>
        <p
          className="text-2xl font-bold shrink-0"
          style={{ color: "#60a5fa" }}
        >
          ${priceUsd}
        </p>
      </div>
      <button
        onClick={() => { setLoading(true); window.location.href = checkoutUrl; }}
        disabled={loading}
        className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-colors"
        style={{
          background: loading ? "#1d4ed8" : "#2563eb",
          opacity: loading ? 0.7 : 1,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Redirecting…" : `Pay $${priceUsd}`}
      </button>
      <p className="text-[#333] text-xs text-center">
        Secure checkout · Stripe · Test card: 4242 4242 4242 4242
      </p>
    </div>
  );
}
