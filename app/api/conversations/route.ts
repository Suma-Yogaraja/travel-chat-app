import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createConversation, getConversations } from "@/lib/db/queries";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const convs = await getConversations(session.user.id);
  return NextResponse.json(convs);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { title } = await req.json().catch(() => ({ title: "New conversation" }));
  const conv = await createConversation(session.user.id, title ?? "New conversation");
  return NextResponse.json(conv);
}
