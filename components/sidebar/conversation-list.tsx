"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export function ConversationList() {
  const pathname = usePathname();
  const [convs, setConvs] = useState<Conversation[]>([]);

  useEffect(() => {
    fetch("/api/conversations")
      .then(r => r.json())
      .then(setConvs)
      .catch(() => {});
  }, [pathname]);

  if (convs.length === 0) {
    return <p className="px-3 py-2 text-xs text-[#444]">No conversations yet</p>;
  }

  return (
    <ul className="space-y-0.5">
      {convs.map(conv => {
        const isActive = pathname === `/chat/${conv.id}`;
        return (
          <li key={conv.id}>
            <Link
              href={`/chat/${conv.id}`}
              className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-[#1a1a1a] text-white"
                  : "text-[#666] hover:bg-[#141414] hover:text-[#aaa]"
              }`}
            >
              <span className="truncate">{conv.title}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
