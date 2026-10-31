"use client";

import { useRouter } from "next/navigation";

export function NewChatButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push("/chat")}
      className="flex w-full items-center gap-2 rounded-lg border border-[#222] bg-[#111] px-3 py-2 text-sm text-[#999] hover:border-[#2a2a2a] hover:bg-[#161616] hover:text-white transition-colors"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      New chat
    </button>
  );
}
