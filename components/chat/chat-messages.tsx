import type { UIMessage } from "ai";

// In AI SDK v7, messages use parts[] instead of content string.
// TextUIPart has type:'text' and DynamicToolUIPart has type:'dynamic-tool'.

function ToolCallBadge({ toolName, state }: { toolName: string; state: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-blue-900/50 px-2 py-0.5 text-xs text-blue-300 font-mono">
      <span>⚡</span> {toolName}
      {state === "output-available" && <span className="text-green-400">✓</span>}
    </span>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  const textParts = message.parts.filter(p => p.type === "text");
  const toolParts = message.parts.filter(p => p.type === "dynamic-tool");

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-100"
        }`}
      >
        {toolParts.map((part, i) => {
          const tool = part as { type: string; toolName: string; state: string };
          return (
            <div key={i} className="mb-2">
              <ToolCallBadge toolName={tool.toolName} state={tool.state} />
            </div>
          );
        })}
        {textParts.map((part, i) => {
          const text = part as { type: string; text: string };
          return (
            <p key={i} className="whitespace-pre-wrap">
              {text.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export function ChatMessages({ messages }: { messages: UIMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 text-sm">
        <div className="text-center">
          <p className="text-2xl mb-2">✈️</p>
          <p>Ask me to find flights, book tickets, or change your seat.</p>
          <p className="mt-1 text-xs text-gray-600">
            Try: "Find flights from JFK to LAX on November 5th"
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-4">
      {messages.map((m, i) => (
        <MessageBubble key={m.id || i} message={m} />
      ))}
    </div>
  );
}
