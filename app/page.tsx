import Link from "next/link";
export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/auth/sign-in-button";

export default async function LandingPage() {
  const session = await auth();
  if (session?.user) redirect("/chat");

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2">
          <span className="text-lg">✈️</span>
          <span className="text-sm font-semibold text-white">TravelChat</span>
        </div>
        <SignInButton variant="nav" />
      </nav>

      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">

        {/* Eyebrow */}
        <p className="mb-5 text-xs font-medium tracking-widest text-blue-400 uppercase">
          AI-powered travel assistant
        </p>

        {/* Title */}
        <h1 className="text-5xl sm:text-6xl font-bold text-white leading-[1.08] tracking-tight max-w-2xl">
          Book flights by just{" "}
          <span className="text-blue-400">talking</span>
        </h1>

        <p className="mt-5 max-w-sm text-[15px] text-[#888] leading-relaxed">
          Search, compare, and book flights through natural conversation. No forms, no menus — just chat.
        </p>

        {/* Actions */}
        <div className="mt-10 flex flex-col items-center gap-3 w-72">
          <SignInButton variant="primary" />
          <Link
            href="/chat/guest"
            className="w-full rounded-xl border border-[#222] px-4 py-2.5 text-sm text-[#888] hover:border-[#333] hover:text-white transition-colors text-center"
          >
            Continue without account
          </Link>
        </div>

        {/* Features */}
        <div className="mt-20 flex items-center gap-8 text-sm text-[#555]">
          <span className="flex items-center gap-1.5"><span className="text-blue-500">✓</span> Flight search</span>
          <span className="flex items-center gap-1.5"><span className="text-blue-500">✓</span> Seat selection</span>
          <span className="flex items-center gap-1.5"><span className="text-blue-500">✓</span> Instant booking</span>
          <span className="flex items-center gap-1.5"><span className="text-blue-500">✓</span> Email confirmation</span>
        </div>
      </div>
    </div>
  );
}
