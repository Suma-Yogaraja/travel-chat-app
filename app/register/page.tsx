"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { validatePassword } from "@/lib/password";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pwError = validatePassword(form.password);
    if (pwError) { setError(pwError); return; }
    if (form.password !== form.confirm) { setError("Passwords don't match"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          password: form.password,
        }),
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
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs text-gray-400">First name</label>
              <input
                type="text" required autoComplete="given-name"
                value={form.firstName} onChange={e => set("firstName", e.target.value)}
                className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                placeholder="Ada"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs text-gray-400">Last name</label>
              <input
                type="text" required autoComplete="family-name"
                value={form.lastName} onChange={e => set("lastName", e.target.value)}
                className="w-full rounded-xl border border-[#2a2a2a] bg-[#111] px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                placeholder="Lovelace"
              />
            </div>
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
              placeholder="Min 8 chars, letters + numbers"
            />
            <p className="mt-1.5 text-xs text-gray-600">At least 8 characters with at least one letter and one number</p>
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
