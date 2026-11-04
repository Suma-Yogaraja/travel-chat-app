"use client";

import { useState, useEffect } from "react";
import type { BookingStatusResponse } from "@/lib/booking-status";

interface PayButtonProps {
  checkoutUrl: string;
  priceUsd: number;
  bookingRef: string;
  flightId: string;
  seatNumber: string;
  passengerName: string;
}

type UIState = "loading" | "pending" | "paid" | "expired" | "cancelled" | "failed";

function mapToUIState(paymentStatus: BookingStatusResponse["paymentStatus"] | undefined): UIState {
  switch (paymentStatus) {
    case "paid":     return "paid";
    case "expired":  return "expired";
    case "failed":   return "failed";
    case "pending":  return "pending";
    default:         return "loading";
  }
}

export function PayButton({ checkoutUrl, priceUsd, bookingRef, flightId, seatNumber, passengerName }: PayButtonProps) {
  const [redirecting, setRedirecting] = useState(false);
  const [uiState, setUiState] = useState<UIState>("loading");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/booking/status?ref=${encodeURIComponent(bookingRef)}`);
        if (!res.ok || stopped) return;
        const data: Partial<BookingStatusResponse> = await res.json();
        if (stopped) return;
        setUiState(mapToUIState(data.paymentStatus));
        setExpiresAt(data.expiresAt ?? null);
        if (data.paymentStatus !== "pending") stopped = true;
      } catch {
        if (!stopped) setUiState("pending"); // assume still payable on network blip
      }
    };

    poll();
    const interval = setInterval(() => {
      if (stopped) { clearInterval(interval); return; }
      poll();
    }, 5000);

    return () => { stopped = true; clearInterval(interval); };
  }, [bookingRef]);

  function handleRebook() {
    window.dispatchEvent(new CustomEvent("rebook", {
      detail: { flightId, seatNumber, passengerName },
    }));
  }

  // --- Paid state ---
  if (uiState === "paid") {
    return (
      <div className="rounded-xl p-4" style={{ background: "#0a1f10", border: "1px solid #166534" }}>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p className="text-green-400 text-sm font-medium">Payment confirmed</p>
        </div>
        <p className="text-[#444] text-xs mt-1 font-mono">{bookingRef}</p>
      </div>
    );
  }

  // --- Expired / cancelled / failed state ---
  if (uiState === "expired" || uiState === "cancelled" || uiState === "failed") {
    const label =
      uiState === "failed"    ? "Payment failed"       :
      uiState === "cancelled" ? "Booking cancelled"    :
                                "Checkout session expired";
    const detail =
      uiState === "failed"    ? "No charge was made." :
                                "This payment link is no longer valid.";

    return (
      <div className="rounded-xl p-4 space-y-3" style={{ background: "#1a0a0a", border: "1px solid #7f1d1d" }}>
        <div>
          <p className="text-red-400 text-sm font-medium">{label}</p>
          <p className="text-[#666] text-xs mt-0.5">{detail}</p>
          <p className="text-[#333] text-xs mt-1 font-mono">{bookingRef}</p>
        </div>
        <button
          onClick={handleRebook}
          className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition-colors"
          style={{ background: "#2563eb" }}
        >
          Start new booking
        </button>
        <p className="text-[#444] text-xs text-center">
          Flight availability and price will be re-checked
        </p>
      </div>
    );
  }

  // --- Loading state ---
  if (uiState === "loading") {
    return (
      <div className="rounded-xl p-4" style={{ background: "#0d1f33", border: "1px solid #1e3a5f" }}>
        <p className="text-[#6b8caa] text-sm">Checking payment status…</p>
      </div>
    );
  }

  // --- Pending: show Pay button, soft warning if near expiry ---
  const nearExpiry = expiresAt ? Date.now() > new Date(expiresAt).getTime() - 5 * 60 * 1000 : false;

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "#0d1f33", border: "1px solid #1e3a5f" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">
            Flight {flightId} · Seat {seatNumber}
          </p>
          <p className="text-[#6b8caa] text-xs mt-0.5 truncate">{passengerName}</p>
          <p className="text-[#444] text-xs mt-1 font-mono">{bookingRef}</p>
        </div>
        <p className="text-2xl font-bold shrink-0" style={{ color: "#60a5fa" }}>
          ${priceUsd}
        </p>
      </div>
      {nearExpiry && (
        <p className="text-yellow-500 text-xs">Session expiring soon — complete payment shortly.</p>
      )}
      <button
        onClick={() => { setRedirecting(true); window.location.href = checkoutUrl; }}
        disabled={redirecting}
        className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-colors"
        style={{ background: redirecting ? "#1d4ed8" : "#2563eb", opacity: redirecting ? 0.7 : 1, cursor: redirecting ? "not-allowed" : "pointer" }}
      >
        {redirecting ? "Redirecting…" : `Pay $${priceUsd}`}
      </button>
      <p className="text-[#333] text-xs text-center">
        Secure checkout · Stripe · Test card: 4242 4242 4242 4242
      </p>
    </div>
  );
}
