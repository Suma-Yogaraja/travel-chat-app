import { auth } from "@/lib/auth";
import { createConversation, saveMessage } from "@/lib/db/queries";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { UIMessage } from "ai";
import { apiHandler } from "@/lib/api-handler";

export const POST = apiHandler(async (req) => {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const { messages }: { messages: UIMessage[] } = body ?? {};
  if (!messages?.length) return new Response("No messages", { status: 400 });

  const firstUserText = messages
    .find(m => m.role === "user")
    ?.parts?.find((p): p is { type: "text"; text: string } => p.type === "text")
    ?.text ?? "";

  let title = "Saved guest conversation";
  if (firstUserText) {
    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: `Generate a short 4-6 word title for a travel chat that starts with: "${firstUserText}". Respond with only the title, no quotes, no punctuation at the end.`,
    }).catch(() => ({ text: "" }));
    if (text.trim()) title = text.trim();
  }

  const conv = await createConversation(session.user.id, title);

  for (const msg of messages) {
    await saveMessage(conv.id, msg.role, msg);
  }

  return Response.json({ id: conv.id });
});
