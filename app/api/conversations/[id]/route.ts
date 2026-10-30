import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMessages } from "@/lib/db/queries";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  try {
    const msgs = await getMessages(id, session.user.id);
    return NextResponse.json(msgs);
  } catch {
    // getMessages throws "Unauthorized" if the conversation doesn't belong to this user
    return new Response("Unauthorized", { status: 403 });
  }
}
