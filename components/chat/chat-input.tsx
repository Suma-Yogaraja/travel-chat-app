"use client";

import { useState, type KeyboardEvent, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="px-4 pb-5 pt-3">
      <div className="max-w-2xl mx-auto">
        <div className={`flex items-end gap-3 rounded-2xl border bg-[#111] px-4 py-3 transition-colors ${
          disabled
            ? "border-[#1a1a1a] opacity-50"
            : "border-[#222] focus-within:border-[#333]"
        }`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message TravelChat..."
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[15px] text-[#e0e0e0] placeholder-[#444] outline-none leading-relaxed"
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || !input.trim()}
            className="flex-shrink-0 mb-0.5 h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {disabled ? (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-[#333]">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
