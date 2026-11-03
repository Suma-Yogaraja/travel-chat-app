"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatInput } from "@/components/chat/chat-input";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const didSendInitial = useRef(false);
  const titleFetched = useRef(false);
  const [title, setTitle] = useState("New conversation");

  // In AI SDK v7, configure the API endpoint via DefaultChatTransport
  const { messages, sendMessage, status, setMessages } = useChat({
    id: params.id,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { conversationId: params.id },
    }),
  });

  // Load existing messages and conversation title from DB
  useEffect(() => {
    fetch(`/api/conversations/${params.id}`)
      .then(r => r.ok ? r.json() : { messages: [], title: "" })
      .then((data: { messages?: Array<{ id: string; role: string; content: unknown }>; title?: string } | Array<{ id: string; role: string; content: unknown }>) => {
        // Handle both array (old) and object (new) response shapes
        const rows = Array.isArray(data) ? data : (data.messages ?? []);
        const convTitle = Array.isArray(data) ? "" : (data.title ?? "");
        if (convTitle) setTitle(convTitle);
        if (rows.length > 0) {
          const uiMessages: UIMessage[] = rows.map((row: { content: unknown }) => row.content as UIMessage);
          setMessages(uiMessages);
        }
      })
      .catch(() => {});
  }, [params.id, setMessages]);

  // Auto-send the initial message if redirected from new-chat page
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !didSendInitial.current) {
      didSendInitial.current = true;
      sendMessage({ text: q });
      router.replace(`/chat/${params.id}`); // remove ?q= from URL
    }
  }, [searchParams, sendMessage, router, params.id]);

  // After first exchange on a new conversation, re-fetch title once the
  // server's fire-and-forget title generation has had time to complete (~2s)
  useEffect(() => {
    if (titleFetched.current || messages.length < 2 || title !== "New conversation") return;
    titleFetched.current = true;
    const timer = setTimeout(() => {
      fetch(`/api/conversations/${params.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.title) setTitle(data.title); })
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages.length, title, params.id]);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-full">
      {/* Chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
          <span className="text-sm font-medium text-gray-200 truncate">{title}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-4">
          <ChatMessages messages={messages} onSendMessage={text => sendMessage({ text })} />
          <div ref={bottomRef} />
        </div>
        <ChatInput
          onSend={text => sendMessage({ text })}
          disabled={isLoading}
        />
      </div>

    </div>
  );
}
