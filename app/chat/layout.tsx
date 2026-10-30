import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
import { ConversationList } from "@/components/sidebar/conversation-list";
import { NewChatButton } from "@/components/sidebar/new-chat-button";
import { UserMenu } from "@/components/auth/user-menu";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex h-full">
      {/* Sidebar — only shown for authenticated users */}
      {session?.user && (
        <aside className="flex w-60 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-900">
          <div className="p-3 border-b border-gray-800">
            <NewChatButton />
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            <ConversationList />
          </nav>
          <div className="border-t border-gray-800">
            <UserMenu session={session} />
          </div>
        </aside>
      )}

      {/* Main chat area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
