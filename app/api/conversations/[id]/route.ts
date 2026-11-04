import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMessages, getConversation, updateConversationTitle, deleteConversation } from "@/lib/db/queries";
import { apiHandler } from "@/lib/api-handler";

export const GET = apiHandler(async (
  _req,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const conv = await getConversation(id, session.user.id);
  if (!conv) return new Response("Not found", { status: 404 });

  const msgs = await getMessages(id, session.user.id);
  return NextResponse.json({ title: conv.title ?? "", messages: msgs });
});

export const PATCH = apiHandler(async (
  req,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const { title } = body ?? {};

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return new Response("Title required", { status: 400 });
  }

  const conv = await getConversation(id, session.user.id);
  if (!conv) return new Response("Not found", { status: 404 });

  await updateConversationTitle(id, title.trim());
  return NextResponse.json({ ok: true });
});

export const DELETE = apiHandler(async (
  _req,
  { params }: { params: Promise<{ id: string }> }
) => {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const conv = await getConversation(id, session.user.id);
  if (!conv) return new Response("Not found", { status: 404 });

  await deleteConversation(id, session.user.id);
  return NextResponse.json({ ok: true });
});
