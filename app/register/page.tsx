"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Registration failed"); return; }

      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.error) { router.push("/login"); return; }
      router.push("/chat");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white">Create account</h1>
          <p className="mt-2 text-sm text-gray-400">Sign up to save your conversations</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Full name</label>
            <input
              type="text" required autoComplete="name"
              value={form.name} onChange={e => set("name", e.target.value)}
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Ada Lovelace"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Email</label>
            <input
              type="email" required autoComplete="email"
              value={form.email} onChange={e => set("email", e.target.value)}
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="ada@example.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Password</label>
            <input
              type="password" required autoComplete="new-password"
              value={form.password} onChange={e => set("password", e.target.value)}
              className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Min 8 characters"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-gray-400">Confirm password</label>
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
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-400 hover:text-blue-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
