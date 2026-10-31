"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";

// Blank new-chat page — conversation is created only when the user sends their first message
export default function NewChatPage() {
  const router = useRouter();
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4">
        <ChatMessages messages={[]} onSendMessage={handleSend} />
      </div>
      <ChatInput onSend={handleSend} disabled={pending} />
    </div>
  );
}
