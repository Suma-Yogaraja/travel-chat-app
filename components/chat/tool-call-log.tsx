"use client";

import type { UIMessage } from "ai";

interface ToolEntry {
  toolName: string;
  input: unknown;
  state: string;
  output?: unknown;
}

function extractToolCalls(messages: UIMessage[]): ToolEntry[] {
  const entries: ToolEntry[] = [];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "dynamic-tool") {
        const p = part as {
          type: string;
          toolName: string;
          state: string;
          input?: unknown;
          output?: unknown;
        };
        entries.push({
          toolName: p.toolName,
          input: p.input,
          state: p.state,
          output: p.output,
        });
      }
    }
  }
  return entries;
}

export function ToolCallLog({ messages }: { messages: UIMessage[] }) {
  const toolCalls = extractToolCalls(messages);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Tool calls
        </h2>
        <p className="text-xs text-gray-600 mt-0.5">What Claude called behind the scenes</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {toolCalls.length === 0 ? (
          <p className="text-xs text-gray-600">No tool calls yet.</p>
        ) : (
          toolCalls.map((tc, i) => (
            <div key={i} className="rounded-lg bg-gray-800/50 p-2.5 text-xs font-mono">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-blue-400 font-semibold">{tc.toolName}</span>
                <span
                  className={`text-[10px] ${
                    tc.state === "output-available" ? "text-green-500" : "text-yellow-500"
                  }`}
                >
                  {tc.state}
                </span>
              </div>
              <div className="text-gray-400 mb-1">
                <span className="text-gray-600">in: </span>
                {(JSON.stringify(tc.input) ?? "…").slice(0, 120)}
              </div>
              {tc.output !== undefined && (
                <div className="text-gray-400">
                  <span className="text-gray-600">out: </span>
                  {(JSON.stringify(tc.output) ?? "…").slice(0, 200)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
