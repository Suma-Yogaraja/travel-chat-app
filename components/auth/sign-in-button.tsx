"use client";

import { useRouter } from "next/navigation";

interface SignInButtonProps {
  variant?: "primary" | "nav";
}

export function SignInButton({ variant = "primary" }: SignInButtonProps) {
  const router = useRouter();

  if (variant === "nav") {
    return (
      <button
        onClick={() => router.push("/login")}
        className="rounded-lg border border-[#222] bg-[#111] px-4 py-1.5 text-sm text-[#aaa] hover:border-[#333] hover:text-white transition-colors"
      >
        Sign in
      </button>
    );
  }

  return (
    <button
      onClick={() => router.push("/login")}
      className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
    >
      Sign in
    </button>
  );
}
