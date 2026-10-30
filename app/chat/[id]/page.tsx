"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";
import { ToolCallLog } from "@/components/chat/tool-call-log";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const bottomRef = useRef<HTMLDivElement>(null);

  // In AI SDK v7, configure the API endpoint via DefaultChatTransport
  const { messages, sendMessage, status, setMessages } = useChat({
    id: params.id,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { conversationId: params.id },
    }),
  });

  // Load existing messages from DB when the conversation ID changes
  useEffect(() => {
    fetch(`/api/conversations/${params.id}`)
      .then(r => r.ok ? r.json() : [])
      .then((dbRows: Array<{ id: string; role: string; content: unknown }>) => {
        if (dbRows.length > 0) {
          // DB stores the full UIMessage as JSONB in `content` — cast it back
          const uiMessages: UIMessage[] = dbRows.map(row => row.content as UIMessage);
          setMessages(uiMessages);
        }
      })
      .catch(() => {});
  }, [params.id, setMessages]);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4">
          <ChatMessages messages={messages} />
          <div ref={bottomRef} />
        </div>
        <ChatInput
          onSend={text => sendMessage({ text })}
          disabled={isLoading}
        />
      </div>

      {/* Tool call log sidebar — shows every MCP tool call in real time */}
      <aside className="hidden w-72 flex-shrink-0 border-l border-gray-800 lg:flex lg:flex-col">
        <ToolCallLog messages={messages} />
      </aside>
    </div>
  );
}
