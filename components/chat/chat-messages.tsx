"use client";

import type { UIMessage } from "ai";
import { SeatMap } from "./seat-map";
import { FlightResults } from "./flight-results";
import { PayButton } from "./pay-button";

// Inline markdown renderer — no external deps, handles what Claude actually outputs
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} className="text-[#a78bfa] bg-[#1a1a2e] px-1 py-0.5 rounded text-[13px] font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    return part;
  });
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Heading
    if (line.startsWith("### ")) {
      elements.push(<h3 key={elements.length} className="font-semibold text-white mt-3 mb-1 text-[15px]">{renderInline(line.slice(4))}</h3>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<h2 key={elements.length} className="font-semibold text-white mt-3 mb-1 text-base">{renderInline(line.slice(3))}</h2>);
      i++; continue;
    }

    // Unordered list — collect consecutive items
    if (/^[-*] /.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={elements.length} className="my-1.5 pl-5 space-y-0.5 list-disc">
          {items.map((item, j) => <li key={j} className="text-[#d4d4d4]">{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s*/, ""));
        i++;
      }
      elements.push(
        <ol key={elements.length} className="my-1.5 pl-5 space-y-0.5 list-decimal">
          {items.map((item, j) => <li key={j} className="text-[#d4d4d4]">{renderInline(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Skip markdown table rows (pipes) — data is shown via UI components
    if (line.trim().startsWith("|")) { i++; continue; }

    // Paragraph
    elements.push(<p key={elements.length} className="text-[15px] text-[#d4d4d4] leading-[1.7]">{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-1.5">{elements}</div>;
}

interface MessageBubbleProps {
  message: UIMessage;
  onSendMessage?: (text: string) => void;
}

function MessageBubble({ message, onSendMessage }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const textParts = message.parts.filter(p => p.type === "text");
  const toolParts = message.parts.filter(p => {
    const t = (p as { type: string }).type;
    return t === "dynamic-tool" || (t.startsWith("tool-") && t !== "tool-result");
  });

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
        {toolParts.map((part, i) => {
          const tool = part as {
            type: string;
            toolName?: string;
            state: string;
            input?: { flightId?: string };
            output?: unknown;
          };
          const toolName = tool.toolName ?? (tool.type.startsWith("tool-") ? tool.type.slice(5) : "");

          if (toolName === "get_flight_seats" && (tool.state === "output-available" || tool.state === "result")) {
            let seats: unknown[] = [];
            if (Array.isArray(tool.output)) {
              seats = tool.output;
            } else if (tool.output && typeof tool.output === "object" && "content" in tool.output) {
              const mcp = tool.output as { content: Array<{ text: string }> };
              try { seats = JSON.parse(mcp.content?.[0]?.text ?? "[]"); } catch { seats = []; }
            }
            return (
              <SeatMap
                key={i}
                seats={seats as Parameters<typeof SeatMap>[0]["seats"]}
                flightId={tool.input?.flightId ?? ""}
                onSelectSeat={seat => onSendMessage?.(`I'd like to select seat ${seat}`)}
              />
            );
          }

          if (toolName === "search_flights" && (tool.state === "output-available" || tool.state === "result")) {
            let flights: unknown[] = [];
            if (Array.isArray(tool.output)) {
              flights = tool.output;
            } else if (tool.output && typeof tool.output === "object" && "content" in tool.output) {
              const mcp = tool.output as { content: Array<{ text: string }> };
              try { flights = JSON.parse(mcp.content?.[0]?.text ?? "[]"); } catch { flights = []; }
            }
            if (flights.length > 0) {
              return (
                <FlightResults
                  key={i}
                  flights={flights as Parameters<typeof FlightResults>[0]["flights"]}
                  onSelectFlight={(flightId, offerId) =>
                    onSendMessage?.(
                      offerId
                        ? `I'd like to book flight ${flightId}. The offer ID is ${offerId}.`
                        : `I'd like to book flight ${flightId}`
                    )
                  }
                />
              );
            }
          }

          if (toolName === "create_checkout" && (tool.state === "output-available" || tool.state === "result")) {
            const output = tool.output as {
              checkoutUrl?: string;
              bookingRef?: string;
              priceUsd?: number;
              flightId?: string;
              seatNumber?: string;
              passengerName?: string;
              error?: string;
            };
            if (output?.checkoutUrl) {
              return (
                <PayButton
                  key={i}
                  checkoutUrl={output.checkoutUrl}
                  priceUsd={output.priceUsd ?? 0}
                  bookingRef={output.bookingRef ?? ""}
                  flightId={output.flightId ?? ""}
                  seatNumber={output.seatNumber ?? ""}
                  passengerName={output.passengerName ?? ""}
                />
              );
            }
          }

          return null;
        })}

        {textParts.map((part, i) => {
          const text = part as { type: string; text: string };
          return <MarkdownText key={i} text={text.text} />;
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
