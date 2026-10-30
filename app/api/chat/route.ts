import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
import { join } from "path";
import { auth } from "@/lib/auth";
import { saveMessage, getConversation } from "@/lib/db/queries";
import { createLoggingHook } from "@/lib/ai-hooks";

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
        // Save full UIMessage (includes text + tool call parts) as JSONB
        await saveMessage(conversationId, "assistant", responseMessage);
      }
    },
  });
}
