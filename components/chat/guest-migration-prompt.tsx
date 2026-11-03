"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";

const STORAGE_KEY = "guestMessages";

export function GuestMigrationPrompt() {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  if (!messages?.length) return null;

  function discard() {
    localStorage.removeItem(STORAGE_KEY);
    setMessages(null);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/conversations/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) throw new Error("Failed");
      const { id } = await res.json();
      localStorage.removeItem(STORAGE_KEY);
      router.push(`/chat/${id}`);
    } catch {
      setSaving(false);
    }
  }

  const msgCount = messages.length;

  return (
    <div className="mx-auto max-w-2xl w-full px-4 pt-6">
      <div className="rounded-xl border border-blue-800/50 bg-blue-950/30 px-4 py-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-blue-300">Save your guest conversation?</p>
          <p className="text-xs text-blue-400/70 mt-0.5">
            {msgCount} message{msgCount !== 1 ? "s" : ""} from your guest session.
            Note: any bookings made as a guest are not saved — sign in before booking to get confirmations.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={save}
            disabled={saving}
            className="text-xs font-medium text-blue-300 hover:text-blue-200 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save it"}
          </button>
          <button
            onClick={discard}
            disabled={saving}
            className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
