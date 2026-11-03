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

// Read skill files once at module load — not per request.
// Prompt caching handles token cost; this avoids repeated disk I/O.
const SKILLS_BASE = ["flight-search", "booking", "seat-management"]
  .map(name => readFileSync(join(process.cwd(), "skills", `${name}.md`), "utf-8"))
  .join("\n\n---\n\n");

function buildSystemPrompt(isGuest: boolean): string {
  const authContext = isGuest
    ? "CURRENT USER: Guest (not signed in). Collect their email before calling book_flight. Do NOT ask whether they are signed in — you already know they are not."
    : "CURRENT USER: Signed in. Do not ask for email or auth status.";

  return `You are a helpful travel assistant. You help users search for flights, book tickets, and manage their seats through conversation.\n\n${SKILLS_BASE}\n\nAlways be friendly and concise. If unsure, ask the user to clarify.\n\n${authContext}`;
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
  const rawMessages = await convertToModelMessages(messages);

  // Trim tool results from old history turns — keep only the most recent call per tool.
  // All tools produce JSON objects that re-inflate context on every subsequent message.
  // For booking tools we preserve the key reference in the placeholder so the model
  // still knows what was booked without carrying the full object.
  const TRIM_TOOLS = new Set([
    "get_flight_seats", "search_flights",
    "book_flight", "get_booking", "get_guest_booking", "change_seat",
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastIdx: Record<string, number> = {};
  rawMessages.forEach((msg: any, i: number) => {
    if (msg.role !== "tool") return;
    for (const part of msg.content ?? []) {
      if (part.type === "tool-result" && TRIM_TOOLS.has(part.toolName)) {
        lastIdx[part.toolName] = i;
      }
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function placeholderFor(toolName: string, output: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = (output ?? {}) as Record<string, any>;
    if (toolName === "get_flight_seats") return "[Seat map already shown to user]";
    if (toolName === "search_flights")   return "[Flight results already shown to user]";
    if (toolName === "book_flight")      return `[Booking confirmed: ref=${o.bookingId ?? o.bookingRef}, flight=${o.flightId}, seat=${o.seat}]`;
    if (toolName === "get_booking" || toolName === "get_guest_booking")
      return `[Booking on file: ref=${o.bookingRef ?? o.bookingId}, flight=${o.flightId}, seat=${o.seat}]`;
    if (toolName === "change_seat")      return `[Seat changed to ${o.seat ?? "new seat"}]`;
    return `[${toolName} result already processed]`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trimmedMessages = rawMessages.map((msg: any, i: number) => {
    if (msg.role !== "tool") return msg;
    return {
      ...msg,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: (msg.content ?? []).map((part: any) => {
        if (part.type !== "tool-result" || !TRIM_TOOLS.has(part.toolName)) return part;
        if (lastIdx[part.toolName] === i) return part; // keep the most recent full result
        return { ...part, output: placeholderFor(part.toolName, part.output) };
      }),
    };
  });

  // Cap history at 30 model messages (~15 exchanges). Beyond that, old context
  // adds cost without helping — any travel booking fits within 15 turns.
  const modelMessages = trimmedMessages.slice(-30);

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

  const systemPrompt = buildSystemPrompt(!session?.user?.id);

  // Prepend system as a cached user message so Anthropic can reuse it across requests.
  // The CSV showed input_cache_read: $0.00 — no caching at all — because the system:
  // string param doesn't get a cache_control header. This pattern fixes that:
  // 2nd+ requests in the same 5-min window pay ~10% of the normal input price for
  // the system prompt + tool definitions (~3500 tokens).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedSystemMessage: any = {
    role: "user",
    content: [
      {
        type: "text",
        text: systemPrompt,
        experimental_providerMetadata: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
    ],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedSystemAck: any = {
    role: "assistant",
    content: [{ type: "text", text: "Understood." }],
  };

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"), // Haiku: ~12× cheaper than Sonnet
    messages: [cachedSystemMessage, cachedSystemAck, ...modelMessages],
    tools: createTravelTools(session?.user?.id, session?.user?.email ?? undefined),
    maxTokens: 350,  // Travel responses should be short — cap output to control cost
    stopWhen: stepCountIs(4),
    onStepFinish: (step) => {
      handleStep(step);
      // Log token usage per step so we can monitor cost
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = step as any;
      if (s.usage) {
        console.log(`[TOKENS] in: ${s.usage.promptTokens}, out: ${s.usage.completionTokens}`);
      }
    },
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
