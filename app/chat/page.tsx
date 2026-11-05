"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { GuestMigrationPrompt } from "@/components/chat/guest-migration-prompt";

// Blank new-chat page — conversation is created only when the user sends their first message
export default function NewChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);

  async function handleSend(text: string) {
    setPending(true);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New conversation" }),
    });
    const conv = await res.json();
    router.push(`/chat/${conv.id}?q=${encodeURIComponent(text)}`);
  }

  // Auto-send if redirected from bookings page with a pre-filled query
  useEffect(() => {
    const q = searchParams.get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: auto-send ?q= URL param on mount
    if (q) handleSend(q);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <GuestMigrationPrompt />
        <div className="px-4">
          <ChatMessages messages={[]} onSendMessage={handleSend} />
        </div>
      </div>
      <ChatInput onSend={handleSend} disabled={pending} />
    </div>
  );
}
