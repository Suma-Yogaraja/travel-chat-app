"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface ConvItemProps {
  conv: Conversation;
  isActive: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function ConvItem({ conv, isActive, onDelete, onRename }: ConvItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conv.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  // Focus input when rename starts
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  function startRename() {
    setDraft(conv.title);
    setMenuOpen(false);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== conv.title) {
      onRename(conv.id, trimmed);
    }
    setRenaming(false);
  }

  function cancelRename() {
    setDraft(conv.title);
    setRenaming(false);
  }

  return (
    <li className="group relative">
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
            if (e.key === "Escape") cancelRename();
          }}
          className="w-full rounded-lg px-3 py-2 text-sm bg-[#1a1a1a] text-white border border-[#333] outline-none"
        />
      ) : (
        <Link
          href={`/chat/${conv.id}`}
          className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors pr-8 ${
            isActive
              ? "bg-[#1a1a1a] text-white"
              : "text-[#666] hover:bg-[#141414] hover:text-[#aaa]"
          }`}
        >
          <span className="truncate">{conv.title}</span>
        </Link>
      )}

      {/* Three-dot button — visible on hover or when menu is open */}
      {!renaming && (
        <div ref={menuRef} className="absolute right-1 top-1/2 -translate-y-1/2">
          <button
            onClick={e => { e.preventDefault(); setMenuOpen(v => !v); }}
            className={`flex h-6 w-6 items-center justify-center rounded text-[#555] hover:text-[#aaa] hover:bg-[#222] transition-colors ${
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="2.5" r="1.5"/>
              <circle cx="8" cy="8" r="1.5"/>
              <circle cx="8" cy="13.5" r="1.5"/>
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-[#2a2a2a] bg-[#111] py-1 shadow-xl">
              <button
                onClick={() => startRename()}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#aaa] hover:bg-[#1a1a1a] hover:text-white transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z"/>
                </svg>
                Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete(conv.id); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#f87171] hover:bg-[#1a1a1a] transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9"/>
                </svg>
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ConversationList() {
  const pathname = usePathname();
  const router = useRouter();
  const [convs, setConvs] = useState<Conversation[]>([]);

  useEffect(() => {
    fetch("/api/conversations")
      .then(r => r.json())
      .then(setConvs)
      .catch(() => {});
  }, [pathname]);

  async function handleDelete(id: string) {
    // Optimistic remove
    setConvs(prev => prev.filter(c => c.id !== id));

    const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Restore on failure
      fetch("/api/conversations").then(r => r.json()).then(setConvs).catch(() => {});
      return;
    }

    // If we deleted the active conversation, go to /chat
    if (pathname === `/chat/${id}`) router.push("/chat");
  }

  async function handleRename(id: string, title: string) {
    // Optimistic update
    setConvs(prev => prev.map(c => c.id === id ? { ...c, title } : c));

    const res = await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      // Restore on failure
      fetch("/api/conversations").then(r => r.json()).then(setConvs).catch(() => {});
    }
  }

  if (convs.length === 0) {
    return <p className="px-3 py-2 text-xs text-[#444]">No conversations yet</p>;
  }

  return (
    <ul className="space-y-0.5">
      {convs.map(conv => (
        <ConvItem
          key={conv.id}
          conv={conv}
          isActive={pathname === `/chat/${conv.id}`}
          onDelete={handleDelete}
          onRename={handleRename}
        />
      ))}
    </ul>
  );
}
