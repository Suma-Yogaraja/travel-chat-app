"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewChatButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleNewChat() {
    setLoading(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New conversation" }),
    });
    const conv = await res.json();
    router.push(`/chat/${conv.id}`);
    setLoading(false);
  }

  return (
    <button
      onClick={handleNewChat}
      disabled={loading}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50"
    >
      <span className="text-lg leading-none">+</span>
      {loading ? "Creating..." : "New chat"}
    </button>
  );
}
