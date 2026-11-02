import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { readFileSync } from "fs";
import { join } from "path";
import { auth } from "@/lib/auth";
import { saveMessage, getConversation, updateConversationTitle, saveBooking } from "@/lib/db/queries";
import { createLoggingHook } from "@/lib/ai-hooks";
import { sendBookingConfirmation } from "@/lib/email";
import { createTravelTools } from "@/lib/tools";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleStep(step: any) {
    // Log tool calls (existing behaviour)
    createLoggingHook()(step);

    // Detect book_flight results and persist immediately per-step.
    // onStepFinish is confirmed to fire (we see [TOOL CALLED] logs); onFinish is less reliable under streaming.
    if (!session?.user?.id || !conversationId) return;

    // toolResults already includes staticToolResults — don't spread both or we get duplicates
    const results = step.toolResults ?? [];
    console.log("[step] toolResults count:", results.length);

    for (const tr of results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typed = tr as any;
      const toolName: string = typed.toolName ?? "";
      const output: unknown = typed.output ?? typed.result;
      console.log("[step] tool:", toolName, "output:", JSON.stringify(output));

      if (toolName !== "book_flight") continue;
      const b = output as { bookingId: string; flightId: string; passengerName: string; seat: string };
      try {
        await saveBooking({
          userId: session.user.id,
          bookingRef: b.bookingId,
          flightId: b.flightId,
          passengerName: b.passengerName,
          seat: b.seat,
        });
        console.log("[step] booking saved:", b.bookingId);
      } catch (err) {
        console.error("[step] saveBooking error:", err);
      }
      if (session.user.email) {
        await sendBookingConfirmation({
          to: session.user.email,
          passengerName: b.passengerName,
          bookingRef: b.bookingId,
          flightId: b.flightId,
          seat: b.seat,
        }).catch(err => console.error("[step] email error:", err));
      }
    }
  }

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools: createTravelTools(session?.user?.id, session?.user?.email ?? undefined),
    stopWhen: stepCountIs(5),
    onStepFinish: handleStep,
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      if (session?.user?.id && conversationId) {
        await saveMessage(conversationId, "assistant", responseMessage);

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
