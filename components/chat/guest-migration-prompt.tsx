"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";

const STORAGE_KEY = "guestMessages";

export function GuestMigrationPrompt() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function migrate() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const messages: UIMessage[] = JSON.parse(raw);
        if (!messages?.length) return;

        setSaving(true);
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

    migrate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!saving) return null;

  return (
    <div className="mx-auto max-w-2xl w-full px-4 pt-6">
      <div className="rounded-xl border border-blue-800/50 bg-blue-950/30 px-4 py-3">
        <p className="text-sm text-blue-300">Saving your guest conversation…</p>
      </div>
    </div>
  );
}
