import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMessages, getConversation, updateConversationTitle, deleteConversation } from "@/lib/db/queries";

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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { title } = await req.json();

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return new Response("Title required", { status: 400 });
  }

  const conv = await getConversation(id, session.user.id);
  if (!conv) return new Response("Not found", { status: 404 });

  await updateConversationTitle(id, title.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  const conv = await getConversation(id, session.user.id);
  if (!conv) return new Response("Not found", { status: 404 });

  await deleteConversation(id, session.user.id);
  return NextResponse.json({ ok: true });
}
