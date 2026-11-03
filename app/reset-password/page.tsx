"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [form, setForm] = useState({ password: "", confirm: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => router.push("/login"), 2000);
      return () => clearTimeout(timer);
    }
  }, [success, router]);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (form.password !== form.confirm) { setError("Passwords don't match"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Reset failed"); return; }
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-sm text-red-400">Invalid reset link.</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-blue-400 hover:text-blue-300">
          Request a new one
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#111] px-6 py-5 text-center">
        <p className="text-sm text-gray-300">Password updated. Redirecting to sign in…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs text-gray-400">New password</label>
        <input
          type="password" required autoComplete="new-password"
          value={form.password} onChange={e => set("password", e.target.value)}
          className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
          placeholder="Min 8 characters"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs text-gray-400">Confirm new password</label>
        <input
          type="password" required autoComplete="new-password"
          value={form.confirm} onChange={e => set("confirm", e.target.value)}
          className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
          placeholder="Repeat password"
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit" disabled={loading}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white">Set new password</h1>
          <p className="mt-2 text-sm text-gray-400">Choose a strong password for your account</p>
        </div>
        <Suspense fallback={<div className="text-center text-sm text-gray-500">Loading…</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
