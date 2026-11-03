"use client";

import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { useState, useRef, useEffect } from "react";

export function UserMenu({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const user = session.user;

  return (
    <div ref={ref} className="relative p-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-gray-800 transition-colors"
      >
        {user?.image ? (
          <img src={user.image} alt="" className="h-7 w-7 rounded-full flex-shrink-0" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm text-gray-200 truncate">{user?.name}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
        </div>
        <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden">
          {/* Profile info */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
            {user?.image ? (
              <img src={user.image} alt="" className="h-10 w-10 rounded-full flex-shrink-0" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="p-1">
            <button
              onClick={() => signOut({ redirectTo: "/" })}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-950/50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
