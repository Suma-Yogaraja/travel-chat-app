import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
import { auth } from "@/lib/auth";
import { createConversation } from "@/lib/db/queries";

// Creates a fresh conversation and immediately redirects to it
export default async function NewChatPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const conv = await createConversation(session.user.id, "New conversation");
  redirect(`/chat/${conv.id}`);
}
