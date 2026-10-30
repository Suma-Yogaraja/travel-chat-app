import Link from "next/link";

export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/auth/sign-in-button";

export default async function LandingPage() {
  const session = await auth();

  // Already logged in — go straight to chat
  if (session?.user) redirect("/chat");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">✈️ TravelChat</h1>
        <p className="mt-3 text-gray-400 max-w-sm">
          Search flights, book tickets, and manage your seats — all through conversation.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        <SignInButton />

        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-600">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <Link
          href="/chat/guest"
          className="w-full rounded-lg border border-gray-700 px-4 py-2 text-center text-sm text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors"
        >
          Continue as guest
        </Link>
        <p className="text-xs text-gray-600 text-center">
          Guest chats are not saved. Sign in to keep your history.
        </p>
      </div>
    </div>
  );
}
