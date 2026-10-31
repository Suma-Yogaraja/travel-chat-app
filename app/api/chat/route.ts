import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
import { join } from "path";
import { auth } from "@/lib/auth";
import { saveMessage, getConversation, updateConversationTitle, saveBooking } from "@/lib/db/queries";
import { createLoggingHook } from "@/lib/ai-hooks";
import { sendBookingConfirmation } from "@/lib/email";

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

  // MCP client is created per-request (serverless-safe).
  // stdio spawns a subprocess locally — swap to HTTP transport for Vercel deployment (Phase 2).
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp-server/index.ts"],
  });
  const mcpClient = await createMCPClient({ transport });
  const tools = await mcpClient.tools();

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: buildSystemPrompt(),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    // onStepFinish fires after each LLM step (including tool-call steps)
    onStepFinish: createLoggingHook(),
  });

  // toUIMessageStreamResponse streams back in the format useChat expects.
  // onFinish fires once the full response is done — save to DB and close MCP.
  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      await mcpClient.close();
      if (session?.user?.id && conversationId) {
        await saveMessage(conversationId, "assistant", responseMessage);

        // Persist any flight bookings made in this exchange
        for (const part of responseMessage.parts) {
          if (part.type === "dynamic-tool" && (part as { toolName?: string }).toolName === "book_flight") {
            const p = part as { toolName: string; state: string; output?: { content?: Array<{ text: string }> } };
            if (p.state === "output-available" && p.output?.content?.[0]?.text) {
              const b = JSON.parse(p.output.content[0].text);
              await saveBooking({
                userId: session.user.id,
                bookingRef: b.bookingId,
                flightId: b.flightId,
                passengerName: b.passengerName,
                seat: b.seat,
              });

              // Send confirmation email if we have the user's email
              if (session.user.email) {
                await sendBookingConfirmation({
                  to: session.user.email,
                  passengerName: b.passengerName,
                  bookingRef: b.bookingId,
                  flightId: b.flightId,
                  seat: b.seat,
                }).catch(() => {}); // non-critical — don't fail the response if email fails
              }
            }
          }
        }

        // Generate a title after the very first exchange (messages has only 1 entry = first user msg)
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
