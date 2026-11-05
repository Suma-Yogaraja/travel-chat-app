"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Suspense } from "react";

interface BookingStatus {
  status: "pending" | "paid" | "expired" | "failed";
  bookingRef?: string;
  flightId?: string;
  seat?: string;
  passengerName?: string;
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { status: authStatus } = useSession();
  const isGuest = authStatus !== "authenticated";
  const [data, setData] = useState<BookingStatus>({ status: "pending" });
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!sessionId) return;

    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/stripe/status?session_id=${encodeURIComponent(sessionId)}`);
        const json: BookingStatus = await res.json();
        if (!stopped) setData(json);
        if (json.status !== "pending") stopped = true;
      } catch {
        // network blip — keep polling
      }
      if (!stopped) setAttempts(a => a + 1);
    };

    poll();
    const interval = setInterval(() => {
      if (stopped) { clearInterval(interval); return; }
      poll();
    }, 2000);

    return () => { stopped = true; clearInterval(interval); };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="text-center space-y-4">
        <p className="text-[#888]">No session ID found.</p>
        <Link href="/chat" className="text-blue-400 hover:text-blue-300 text-sm">Back to chat</Link>
      </div>
    );
  }

  if (data.status === "pending" && attempts <= 30) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-2 border-blue-500 border-t-transparent"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
        <p className="text-[#888] text-sm">Confirming your payment…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (data.status === "paid") {
    return (
      <div className="flex flex-col items-center gap-5 text-center max-w-sm">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: "rgba(34,197,94,0.15)", border: "1.5px solid rgba(34,197,94,0.4)" }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-white mb-1">Booking confirmed!</h1>
          <p className="text-[#666] text-sm">A confirmation email is on its way.</p>
        </div>
        <div className="w-full rounded-xl border border-[#1e1e1e] bg-[#111] px-5 py-4 space-y-2 text-sm text-left">
          <div className="flex justify-between">
            <span className="text-[#666]">Passenger</span>
            <span className="text-white">{data.passengerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#666]">Flight</span>
            <span className="text-white">{data.flightId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#666]">Seat</span>
            <span className="text-white">{data.seat}</span>
          </div>
          <div className="flex justify-between border-t border-[#1e1e1e] pt-2 mt-1">
            <span className="text-[#666]">Booking ref</span>
            <span className="text-white font-mono text-xs">{data.bookingRef}</span>
          </div>
        </div>
        <p className="text-[#444] text-xs text-center leading-relaxed">
          Note: this is a simulated booking. No real airline reservation has been issued.
        </p>
        {isGuest ? (
          <div className="w-full space-y-3">
            <p className="text-[#555] text-xs text-center">Save your booking ref — you&apos;ll need it to manage your booking in the chat.</p>
            <Link
              href="/chat/guest"
              className="block w-full py-2.5 text-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Back to chat
            </Link>
          </div>
        ) : (
          <div className="flex gap-3 w-full">
            <Link
              href="/chat/bookings"
              className="flex-1 py-2.5 text-center rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              My bookings
            </Link>
            <Link
              href="/chat"
              className="flex-1 py-2.5 text-center rounded-xl border border-[#1e1e1e] hover:bg-[#161616] text-[#888] text-sm transition-colors"
            >
              Back to chat
            </Link>
          </div>
        )}
      </div>
    );
  }

  // expired, failed, or timeout
  const isTimeout = data.status === "pending" && attempts > 30;
  return (
    <div className="flex flex-col items-center gap-5 text-center max-w-sm">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: "rgba(239,68,68,0.1)", border: "1.5px solid rgba(239,68,68,0.3)" }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-white mb-1">
          {isTimeout ? "Still processing…" : data.status === "expired" ? "Session expired" : "Payment not completed"}
        </h1>
        <p className="text-[#666] text-sm">
          {isTimeout
            ? "Taking longer than expected. Check your bookings page or email."
            : "No charge was made. Start a new booking in the chat."}
        </p>
      </div>
      <Link
        href={isGuest ? "/chat/guest" : "/chat"}
        className="w-full py-2.5 text-center rounded-xl border border-[#1e1e1e] hover:bg-[#161616] text-[#888] text-sm transition-colors"
      >
        Back to chat
      </Link>
      {isTimeout && !isGuest && (
        <Link
          href="/chat/bookings"
          className="text-blue-400 hover:text-blue-300 text-sm"
        >
          Check my bookings
        </Link>
      )}
    </div>
  );
}

export default function BookingSuccessPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <Suspense
        fallback={
          <div className="text-[#888] text-sm">Loading…</div>
        }
      >
        <SuccessContent />
      </Suspense>
    </div>
  );
}
