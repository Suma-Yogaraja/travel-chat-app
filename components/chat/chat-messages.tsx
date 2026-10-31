"use client";

import type { UIMessage } from "ai";
import { SeatMap } from "./seat-map";

interface MessageBubbleProps {
  message: UIMessage;
  onSendMessage?: (text: string) => void;
}

function MessageBubble({ message, onSendMessage }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const textParts = message.parts.filter(p => p.type === "text");
  const toolParts = message.parts.filter(p => p.type === "dynamic-tool");

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-tr-sm bg-[#1e1e1e] border border-[#2a2a2a] px-4 py-3 text-[15px] text-[#e0e0e0] leading-relaxed">
          {textParts.map((part, i) => {
            const text = part as { type: string; text: string };
            return <p key={i} className="whitespace-pre-wrap">{text.text}</p>;
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex-1 min-w-0 space-y-4">
        {/* Seat map */}
        {toolParts.map((part, i) => {
          const tool = part as {
            type: string;
            toolName: string;
            state: string;
            input?: { flightId?: string };
            output?: { content?: Array<{ text: string }> };
          };
          if (tool.toolName === "get_flight_seats" && tool.state === "output-available") {
            const rawText = tool.output?.content?.[0]?.text ?? "[]";
            const seats = Array.isArray(JSON.parse(rawText)) ? JSON.parse(rawText) : [];
            return (
              <SeatMap
                key={i}
                seats={seats}
                flightId={tool.input?.flightId ?? ""}
                onSelectSeat={seat => onSendMessage?.(`I'd like to book seat ${seat}`)}
              />
            );
          }
          return null;
        })}

        {/* Text */}
        {textParts.map((part, i) => {
          const text = part as { type: string; text: string };
          return (
            <p key={i} className="text-[15px] text-[#d4d4d4] leading-[1.7] whitespace-pre-wrap">
              {text.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

interface ChatMessagesProps {
  messages: UIMessage[];
  onSendMessage?: (text: string) => void;
}

export function ChatMessages({ messages, onSendMessage }: ChatMessagesProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 text-center px-4">
        <div>
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-blue-600 flex items-center justify-center text-2xl">
            ✈️
          </div>
          <h2 className="text-xl font-semibold text-white">How can I help you?</h2>
          <p className="mt-1.5 text-sm text-[#666]">Search flights, book tickets, or manage your seats.</p>
        </div>

        <div className="flex flex-col gap-2 w-full max-w-sm">
          {[
            "Find flights from JFK to LAX",
            "Show me available seats on flight F1",
            "Book flight F2 for John Smith in seat 5A",
          ].map(s => (
            <button
              key={s}
              onClick={() => onSendMessage?.(s)}
              className="rounded-xl border border-[#1e1e1e] bg-[#111] px-4 py-3 text-left text-sm text-[#888] hover:border-[#2a2a2a] hover:bg-[#161616] hover:text-[#ccc] transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 py-8 max-w-2xl mx-auto w-full">
      {messages.map((m, i) => (
        <MessageBubble key={m.id || i} message={m} onSendMessage={onSendMessage} />
      ))}
    </div>
  );
}
