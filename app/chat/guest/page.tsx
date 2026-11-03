"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { ToolCallLog } from "@/components/chat/tool-call-log";

export default function GuestChatPage() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);

  function handleSignIn() {
    if (messages.length > 0) {
      try {
        localStorage.setItem("guestMessages", JSON.stringify(messages));
      } catch { /* ignore */ }
    }
    router.push("/login");
  }

  // No conversationId — messages live in React state only, never written to DB
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full flex-col">
      {/* Guest banner */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-2">
        <span className="text-xs text-gray-500">
          Guest mode — chats and bookings are not saved, no confirmation emails sent
        </span>
        <button
          onClick={handleSignIn}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex-shrink-0 ml-4"
        >
          Sign in to save →
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4">
            <ChatMessages messages={messages} onSendMessage={text => sendMessage({ text })} />
            <div ref={bottomRef} />
          </div>
          <ChatInput
            onSend={text => sendMessage({ text })}
            disabled={isLoading}
          />
        </div>

        {/* Tool call log sidebar */}
        <aside className="hidden w-72 flex-shrink-0 border-l border-gray-800 lg:flex lg:flex-col">
          <ToolCallLog messages={messages} />
        </aside>
      </div>
    </div>
  );
}
