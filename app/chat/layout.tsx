import { auth } from "@/lib/auth";
import Link from "next/link";
export const dynamic = "force-dynamic";
import { ConversationList } from "@/components/sidebar/conversation-list";
import { NewChatButton } from "@/components/sidebar/new-chat-button";
import { UserMenu } from "@/components/auth/user-menu";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex h-full bg-[#0a0a0a]">
      {session?.user && (
        <aside className="flex w-60 flex-shrink-0 flex-col border-r border-[#1a1a1a] bg-[#0a0a0a]">
          {/* Logo */}
          <div className="flex items-center gap-2 px-4 h-14 border-b border-[#1a1a1a]">
            <span>✈️</span>
            <span className="text-sm font-semibold text-white">TravelChat</span>
          </div>

          {/* New chat */}
          <div className="p-3">
            <NewChatButton />
          </div>

          {/* Conversations */}
          <div className="px-3 mb-1">
            <p className="text-[10px] font-medium uppercase tracking-widest text-[#444]">Recent</p>
          </div>
          <nav className="flex-1 overflow-y-auto px-2">
            <ConversationList />
          </nav>

          {/* Bookings link */}
          <div className="border-t border-[#1a1a1a] p-2">
            <Link
              href="/chat/bookings"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#666] hover:bg-[#141414] hover:text-[#aaa] transition-colors"
            >
              <span>🎫</span> My Bookings
            </Link>
          </div>

          {/* User */}
          <div className="border-t border-[#1a1a1a]">
            <UserMenu session={session} />
          </div>
        </aside>
      )}

      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
