import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { readFileSync } from "fs";
import { join } from "path";
import { auth } from "@/lib/auth";
import { saveMessage, getConversation, updateConversationTitle, saveBooking } from "@/lib/db/queries";
import { createLoggingHook } from "@/lib/ai-hooks";
import { sendBookingConfirmation } from "@/lib/email";
import { travelTools } from "@/lib/tools";

function buildSystemPrompt(): string {
  const skillFiles = ["flight-search", "booking", "seat-management"];
  const skills = skillFiles
    .map(name => readFileSync(join(process.cwd(), "skills", `${name}.md`), "utf-8"))
    .join("\n\n---\n\n");

  return `You are a helpful travel assistant. You help users search for flights, book tickets, and manage their seats through conversation.\n\n${skills}\n\nAlways be friendly and concise. If unsure, ask the user to clarify.`;
}

export async function POST(req: Request) {
  const session = await auth();
  const { messages, conversationId }: { messages: UIMessage[]; conversationId?: string } =
    await req.json();

  // Security: if a conversationId is provided, verify ownership
  if (conversationId && session?.user?.id) {
    const conv = await getConversation(conversationId, session.user.id);
    if (!conv) return new Response("Unauthorized", { status: 403 });
  }

  // Save the incoming user message (authenticated users only)
  // messages.at(-1) is the UIMessage the user just sent — stored as JSONB
  if (session?.user?.id && conversationId) {
    const userMsg = messages.at(-1);
    if (userMsg) await saveMessage(conversationId, "user", userMsg);
  }

  // Convert UIMessage[] → ModelMessage[] for streamText.
  // AI SDK v7 separates the UI representation from the model representation.
  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools: travelTools,
    stopWhen: stepCountIs(5),
    onStepFinish: createLoggingHook(),
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      if (session?.user?.id && conversationId) {
        await saveMessage(conversationId, "assistant", responseMessage);

        // Persist any flight bookings made in this exchange.
        // Inline tools return plain objects (not MCP's {content:[{text:...}]} shape).
        for (const part of responseMessage.parts) {
          const p = part as unknown as { toolName?: string; state?: string; result?: unknown };
          if (p.toolName === "book_flight" && p.state === "result") {
              const b = p.result as { bookingId: string; flightId: string; passengerName: string; seat: string };
              await saveBooking({
                userId: session.user.id,
                bookingRef: b.bookingId,
                flightId: b.flightId,
                passengerName: b.passengerName,
                seat: b.seat,
              });

              if (session.user.email) {
                await sendBookingConfirmation({
                  to: session.user.email,
                  passengerName: b.passengerName,
                  bookingRef: b.bookingId,
                  flightId: b.flightId,
                  seat: b.seat,
                }).catch(() => {});
              }
          }
        }

        if (messages.length === 1) {
          const userText = messages[0].parts
            ?.find((p): p is { type: "text"; text: string } => p.type === "text")
            ?.text ?? "";
          const { text: title } = await generateText({
            model: anthropic("claude-haiku-4-5-20251001"),
            prompt: `Generate a short 4-6 word title for a travel chat that starts with this message: "${userText}". Respond with only the title, no quotes, no punctuation at the end.`,
          });
          await updateConversationTitle(conversationId, title.trim());
        }
      }
    },
  });
}
