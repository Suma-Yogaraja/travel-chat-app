"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"pending" | "success" | "error">(() =>
    token ? "pending" : "error"
  );
  const [errorMsg, setErrorMsg] = useState(() =>
    token ? "" : "Invalid verification link. No token found."
  );

  useEffect(() => {
    if (!token) return;

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async res => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (ok) {
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Verification failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Something went wrong. Please check your connection and try again.");
      });
  }, [token]);

  useEffect(() => {
    if (status === "success") {
      const timer = setTimeout(() => router.push("/login"), 3000);
      return () => clearTimeout(timer);
    }
  }, [status, router]);

  if (status === "pending") {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-6 py-5 text-center">
        <p className="text-sm text-gray-400">Verifying your email address…</p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-6 py-5 text-center space-y-2">
        <p className="text-sm font-medium text-white">Email verified!</p>
        <p className="text-sm text-gray-400">Your account is active. Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-red-400">{errorMsg}</p>
      <Link href="/login" className="text-sm text-blue-400 hover:text-blue-300">
        Back to sign in
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white">Verify your email</h1>
          <p className="mt-2 text-sm text-gray-400">One click and you&apos;re all set</p>
        </div>
        <Suspense fallback={<div className="text-center text-sm text-gray-500">Loading…</div>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}
