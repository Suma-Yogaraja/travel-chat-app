"use client";

import { signOut } from "next-auth/react";
import type { Session } from "next-auth";

export function UserMenu({ session }: { session: Session }) {
  return (
    <div className="flex items-center gap-2 p-2">
      {session.user?.image && (
        <img src={session.user.image} alt="" className="h-7 w-7 rounded-full" />
      )}
      <span className="flex-1 truncate text-sm text-gray-300">{session.user?.name}</span>
      <button
        onClick={() => signOut({ redirectTo: "/" })}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}
