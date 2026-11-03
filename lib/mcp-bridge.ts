import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tool, jsonSchema } from "ai";
import type { ToolSet } from "ai";
import { createTravelMcpServer } from "@/mcp-server/index";

// Tools served via the MCP server — session-agnostic, read-only flight data.
// Write operations and anything needing auth/session stay as direct tools in lib/tools.ts.
const MCP_TOOL_NAMES = new Set(["search_flights", "get_flight_seats"]);

// Module-level singleton — connect once per server process, reuse across requests.
let _tools: ToolSet | null = null;
let _initPromise: Promise<ToolSet> | null = null;

async function initMcpTools(): Promise<ToolSet> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createTravelMcpServer();
  await server.connect(serverTransport);

  const client = new Client({ name: "travel-app", version: "1.0.0" });
  await client.connect(clientTransport);

  const { tools: defs } = await client.listTools();

  const tools: ToolSet = {};
  for (const def of defs) {
    if (!MCP_TOOL_NAMES.has(def.name)) continue;
    tools[def.name] = tool({
      description: def.description ?? "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: jsonSchema(def.inputSchema as any),
      execute: async (input) => {
        const result = await client.callTool({
          name: def.name,
          arguments: input as Record<string, unknown>,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = result.content as any[];
        const textPart = content.find((c: { type: string }) => c.type === "text");
        const text: string = textPart?.text ?? "{}";
        try { return JSON.parse(text); } catch { return text; }
      },
    });
  }

  return tools;
}

export async function connectMcpTools(): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  if (_tools) return { tools: _tools, close: async () => {} };
  if (!_initPromise) {
    _initPromise = initMcpTools().then(t => { _tools = t; return t; });
  }
  const tools = await _initPromise;
  return { tools, close: async () => {} };
}
