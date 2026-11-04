import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tool, jsonSchema } from "ai";
import type { ToolSet } from "ai";
import { createTravelMcpServer } from "@/mcp-server/index";
import { persistFlightOffer } from "@/lib/offers/offer-service";

// Tools served via the MCP server — session-agnostic, read-only flight data.
// Write operations and anything needing auth/session stay as direct tools in lib/tools.ts.
const MCP_TOOL_NAMES = new Set(["search_flights", "get_flight_seats"]);

// Connection lifecycle concern: singleton per server process, shared across requests.
// User identity concern: request-scoped wrappers capture an immutable McpContext per call.
// Never store user identity in module-level state — concurrent requests would overwrite each other.

interface ToolDef {
  name: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any;
}

let _client: Client | null = null;
let _defs: ToolDef[] | null = null;
let _initPromise: Promise<void> | null = null;

async function ensureMcpConnected(): Promise<{ client: Client; defs: ToolDef[] }> {
  if (_client && _defs) return { client: _client, defs: _defs };

  if (!_initPromise) {
    _initPromise = (async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createTravelMcpServer();
      await server.connect(serverTransport);

      const client = new Client({ name: "travel-app", version: "1.0.0" });
      await client.connect(clientTransport);

      const { tools: defs } = await client.listTools();
      _client = client;
      _defs = defs.filter(d => MCP_TOOL_NAMES.has(d.name));
    })();
  }

  await _initPromise;
  return { client: _client!, defs: _defs! };
}

async function callMcpTool(
  client: Client,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: input });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = result.content as any[];
  const textPart = content.find((c: { type: string }) => c.type === "text");
  const text: string = textPart?.text ?? "{}";
  try { return JSON.parse(text); } catch { return text; }
}

export type McpContext = {
  userId?: string;
  guestSessionId?: string; // future: stable cookie-based guest session identity
};

// Returns request-scoped tool wrappers that close over the immutable context.
// The underlying MCP connection is reused across requests (singleton above).
export async function connectMcpTools(
  context: McpContext = {},
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const { client, defs } = await ensureMcpConnected();

  const tools: ToolSet = {};

  for (const def of defs) {
    if (def.name === "search_flights") {
      tools[def.name] = tool({
        description: def.description ?? "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: jsonSchema(def.inputSchema as any),
        execute: async (input) => {
          const flights = await callMcpTool(client, "search_flights", input as Record<string, unknown>);
          if (!Array.isArray(flights)) return flights;

          // Persist each offer and attach the UUID so Claude can pass it to create_checkout.
          // ownerUserId and guestSessionId come from the immutable request context —
          // never accepted from the model's tool arguments.
          const enriched = await Promise.all(
            flights.map(async (flight) => {
              try {
                const offerId = await persistFlightOffer(flight, context);
                return { ...flight, offerId };
              } catch (err) {
                console.error("[mcp-bridge] offer persist error:", err);
                return flight; // degrade gracefully — flight still shown, offerId missing
              }
            })
          );
          return enriched;
        },
      });
    } else {
      // get_flight_seats — proxy unchanged, no context needed
      tools[def.name] = tool({
        description: def.description ?? "",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: jsonSchema(def.inputSchema as any),
        execute: async (input) => callMcpTool(client, def.name, input as Record<string, unknown>),
      });
    }
  }

  return { tools, close: async () => {} };
}
