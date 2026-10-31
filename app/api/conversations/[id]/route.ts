import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMessages, getConversation } from "@/lib/db/queries";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  try {
    const [conv, msgs] = await Promise.all([
      getConversation(id, session.user.id),
      getMessages(id, session.user.id),
    ]);
    return NextResponse.json({ title: conv?.title ?? "", messages: msgs });
  } catch {
    return new Response("Unauthorized", { status: 403 });
  }
}
