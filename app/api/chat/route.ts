import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage, ToolSet, ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { readFileSync } from "fs";
import { join } from "path";
import { auth } from "@/lib/auth";
import { saveMessage, getConversation, updateConversationTitle } from "@/lib/db/queries";
import { createLoggingHook } from "@/lib/ai-hooks";
import { createTravelTools } from "@/lib/tools";
import { connectMcpTools } from "@/lib/mcp-bridge";
import { getOrCreateGuestSession } from "@/lib/guest-session";
import { searchFlightsPlaceholder } from "@/lib/chat-history";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiHandler } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { langfuseProcessor } from "@/lib/langfuse-processor";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";

// Pass per-call to guarantee the integration is used even if globalThis registration
// timing differs across Next.js module contexts.
const langfuseIntegration = new LangfuseVercelAiSdkIntegration();

// Read skill files once at module load — not per request.
const SKILLS_BASE = ["flight-search", "booking", "seat-management"]
  .map(name => readFileSync(join(process.cwd(), "skills", `${name}.md`), "utf-8"))
  .join("\n\n---\n\n");

// Static portion of the system prompt — loaded once at module level to avoid repeated FS I/O.
// Anthropic prompt caching requires explicit cache_control breakpoints; it does not happen
// automatically. Add providerOptions per-message to opt in when that trade-off is worth it.
// The dynamic portion (date + auth context) is appended per-request and must NOT be cached.
const STATIC_SYSTEM = `You are a helpful travel assistant. You help users search for flights, book tickets, and manage their seats through conversation.\n\n${SKILLS_BASE}\n\nAlways be friendly and concise. If unsure, ask the user to clarify.`;

export const POST = apiHandler(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
  if (!checkRateLimit(ip).allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  const session = await auth();

  // Read the body as text first so we can enforce a size cap regardless of whether
  // the client sends a Content-Length header (chunked transfers omit it).
  const rawBody = await req.text().catch(() => null);
  if (!rawBody || rawBody.length > 131_072) { // 128 KB
    return new Response(rawBody === null ? "Invalid request body" : "Payload too large", {
      status: rawBody === null ? 400 : 413,
    });
  }
  let body: { messages?: UIMessage[]; conversationId?: string };
  try { body = JSON.parse(rawBody); } catch { return new Response("Invalid request body", { status: 400 }); }
  if (!Array.isArray(body.messages)) {
    return new Response("Invalid request body", { status: 400 });
  }
  if (body.messages.length > 100) {
    return new Response("Too many messages", { status: 400 });
  }
  const { messages, conversationId } = body as { messages: UIMessage[]; conversationId?: string };

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
    "get_booking", "get_guest_booking", "change_seat",
    "create_checkout",
  ]);
  const lastIdx: Record<string, number> = {};
  rawMessages.forEach((msg: ModelMessage, i: number) => {
    if (msg.role !== "tool") return;
    for (const part of msg.content ?? []) {
      if (part.type === "tool-result" && TRIM_TOOLS.has(part.toolName)) {
        lastIdx[part.toolName] = i;
      }
    }
  });

  function placeholderFor(toolName: string, output: unknown): Record<string, string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = (output && typeof output === "object" ? output : {}) as Record<string, any>;
    let summary: string;
    if (toolName === "get_flight_seats") summary = "[Seat map already shown to user]";
    else if (toolName === "search_flights") {
      summary = searchFlightsPlaceholder(output);
    }
    else if (toolName === "get_booking" || toolName === "get_guest_booking")
      summary = `[Booking on file: ref=${o.bookingRef ?? o.bookingId}, flight=${o.flightId}, seat=${o.seat}]`;
    else if (toolName === "change_seat") summary = `[Seat changed to ${o.seat ?? "new seat"}]`;
    else if (toolName === "create_checkout") summary = `[Checkout created: ref=${o.bookingRef}, flight=${o.flightId}, seat=${o.seatNumber}]`;
    else summary = `[${toolName} result already processed]`;
    // Return an object — AI SDK does `'providerOptions' in output` which throws on strings
    return { _trimmed: summary };
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
        // part.output or part.result depending on AI SDK version
        const raw = part.output ?? part.result;
        return { ...part, output: placeholderFor(part.toolName, raw) };
      }),
    };
  });

  // Cap history at 30 model messages (~15 exchanges). Beyond that, old context
  // adds cost without helping — any travel booking fits within 15 turns.
  const slicedMessages = trimmedMessages.slice(-30);

  // After slicing, a tool-result message can be orphaned if its matching assistant
  // tool-call message was cut off. The model errors on orphaned tool results, so
  // filter them out by collecting every toolCallId still present in the slice.
  const callIdsInSlice = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const msg of slicedMessages as any[]) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content ?? []) {
      if (part.type === "tool-call") callIdsInSlice.add(part.toolCallId);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelMessages = (slicedMessages as any[]).flatMap(msg => {
    if (msg.role !== "tool") return [msg];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (msg.content ?? []).filter((p: any) =>
      p.type !== "tool-result" || callIdsInSlice.has(p.toolCallId)
    );
    return content.length > 0 ? [{ ...msg, content }] : [];
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleStep(step: any) {
    createLoggingHook()(step);
  }

  const isGuest = !session?.user?.id;
  const authContext = isGuest
    ? "CURRENT USER: Guest (not signed in). Before booking, call send_booking_otp with their email, wait for them to confirm the OTP, then call create_checkout with passengerEmail and otp included. Do NOT ask whether they are signed in — you already know they are not."
    : "CURRENT USER: Signed in. Do not ask for email or auth status.";
  const dynamicContext = `${authContext}\n\nToday's date is ${new Date().toISOString().slice(0, 10)}. Use this to resolve relative dates like "today", "tomorrow", or "next Friday" into YYYY-MM-DD format.`;

  const fullSystem = `${STATIC_SYSTEM}\n\n${dynamicContext}`;

  // For guest requests, read the existing guest-session cookie or issue a new one.
  // The session ID ties every offer persisted during this search to the same guest,
  // so checkout can verify ownership without accepting anything from the model.
  let guestSessionId: string | undefined;
  let guestSetCookie: string | undefined;
  if (isGuest) {
    const gs = getOrCreateGuestSession(req);
    guestSessionId = gs.guestSessionId;
    guestSetCookie = gs.setCookie;
  }

  // Connect MCP server in-process — provides search_flights + get_flight_seats.
  // Pass userId / guestSessionId so search_flights wrappers bind persisted offers to the right principal.
  const { tools: mcpTools, close: closeMcp } = await connectMcpTools({ userId: session?.user?.id, guestSessionId });
  const sessionTools = createTravelTools({ userId: session?.user?.id, userEmail: session?.user?.email ?? undefined, guestSessionId });
  const allTools = { ...mcpTools, ...sessionTools } as unknown as ToolSet;

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: fullSystem,
    messages: modelMessages,
    tools: allTools,
    maxOutputTokens: 600,
    stopWhen: stepCountIs(4),
    // recordInputs: false suppresses prompt messages and gen_ai.tool.call.arguments spans.
    // Tool call args (incl. otp/passengerEmail) still appear in gen_ai.output.messages
    // because those are model outputs. Full suppression requires recordOutputs: false,
    // which removes all model response visibility — not worth the tradeoff here.
    telemetry: { isEnabled: true, functionId: "travel-chat", recordInputs: false, integrations: [langfuseIntegration] },
    onStepFinish: async (step) => {
      await handleStep(step);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = step as any;
      if (s.usage) {
        logger.info("tokens", { in: s.usage.inputTokens, out: s.usage.outputTokens });
      }
    },
  });

  return result.toUIMessageStreamResponse({
    headers: guestSetCookie ? { "Set-Cookie": guestSetCookie } : undefined,
    onFinish: async ({ responseMessage }) => {
      // Flush OTel spans to Langfuse before the serverless instance is frozen.
      await langfuseProcessor.forceFlush();
      await closeMcp();
      if (session?.user?.id && conversationId) {
        await saveMessage(conversationId, "assistant", responseMessage).catch(err =>
          logger.error("chat_save_message_error", { conversationId, error: logger.err(err) })
        );

        if (messages.length === 1) {
          const userText = messages[0].parts
            ?.find((p): p is { type: "text"; text: string } => p.type === "text")
            ?.text ?? "";
          const safeText = userText.replace(/"/g, "'").slice(0, 200);
          generateText({
            model: anthropic("claude-haiku-4-5-20251001"),
            prompt: `Generate a short 4-6 word title for a travel chat that starts with this message: "${safeText}". Respond with ONLY the title, no quotes, no punctuation at the end, nothing else.`,
          }).then(({ text: title }) => updateConversationTitle(conversationId, title.trim()))
            .catch(err => logger.error("chat_title_error", { conversationId, error: logger.err(err) }));
        }
      }
    },
  });
});
