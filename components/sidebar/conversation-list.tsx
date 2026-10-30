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
  }, [pathname]); // refresh list when navigation changes

  if (convs.length === 0) {
    return <p className="px-3 py-2 text-xs text-gray-500">No conversations yet</p>;
  }

  return (
    <ul className="space-y-0.5">
      {convs.map(conv => (
        <li key={conv.id}>
          <Link
            href={`/chat/${conv.id}`}
            className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
              pathname === `/chat/${conv.id}`
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {conv.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
