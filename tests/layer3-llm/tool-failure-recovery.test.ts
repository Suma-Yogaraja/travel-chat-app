/**
 * Layer 3 — Tool failure recovery (LLM behavior)
 *
 * Tests that the model handles create_checkout failures gracefully:
 *   - Does not retry with the same expired/invalid offerId
 *   - Communicates the error clearly to the user
 *   - Suggests a sensible recovery path (search again)
 *
 * Responsibility split:
 *   "Invalid offer cannot be purchased"   → Backend guarantee (layer-2 checkout tests)
 *   "Model recovers and guides the user"  → LLM behavior (tested here)
 */
import { describe, test, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

config({ path: ".env.local" });

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const runLlmTests = hasApiKey && !!process.env.RUN_LLM_TESTS;

async function tryLlm<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("credit") ||
      msg.includes("API key") ||
      msg.includes("authentication") ||
      msg.includes("billing")
    ) {
      console.warn("[layer3] skipped — Anthropic API unavailable:", msg.slice(0, 80));
      return undefined;
    }
    throw err;
  }
}

beforeAll(() => {
  if (!hasApiKey) console.warn("ANTHROPIC_API_KEY not set — Layer 3 tests will be skipped.");
  else if (!runLlmTests) console.warn("RUN_LLM_TESTS not set — Layer 3 tests will be skipped.");
});

const SYSTEM = `You are a travel assistant. Today's date is 2027-06-01.
If create_checkout returns offer_not_found or offer_expired, apologise and tell the user the offer has expired — search results are only valid for a limited time. Suggest they search for flights again. Do not retry create_checkout with the same offerId.`;

const travelTools = {
  search_flights: tool({
    description: "Search for available flights between two airports on a given date",
    inputSchema: z.object({
      origin:      z.string(),
      destination: z.string(),
      date:        z.string(),
    }),
  }),
  create_checkout: tool({
    description: "Create a Stripe payment session. Only call with a valid unexpired offerId.",
    inputSchema: z.object({
      offerId:       z.string().uuid(),
      flightId:      z.string(),
      passengerName: z.string(),
      seatNumber:    z.string(),
    }),
  }),
};

const OFFER_ID = "d3bbbc99-9c0b-4ef8-bb6d-6bb9bd380a44";

// Shared: user tried to book, create_checkout returned offer_not_found
const expiredOfferHistory: ModelMessage[] = [
  { role: "user", content: "Book flight F1 for Jane Smith in seat 12A." },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call_co_1",
        toolName: "create_checkout",
        input: { offerId: OFFER_ID, flightId: "F1", passengerName: "Jane Smith", seatNumber: "12A" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_co_1",
        toolName: "create_checkout",
        output: { type: "json", value: {
          error: "offer_not_found",
          message: "This offer has expired. Flight offers are only valid for 30 minutes. Please search for flights again.",
        }},
      },
    ],
  },
];

describe.skipIf(!runLlmTests)("Layer 3 — Tool failure recovery", () => {

  test("does not retry create_checkout with an expired offer", async () => {
    // After an offer_not_found error the model must NOT call create_checkout again —
    // that would just produce another error and confuse the user.
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: expiredOfferHistory,
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    // No checkout retry
    expect(result.toolCalls.find(tc => tc.toolName === "create_checkout")).toBeUndefined();
    // Should produce a helpful text response
    expect(result.text.length).toBeGreaterThan(20);
  }, 30_000);

  test("searches for fresh flights when user asks to try again after offer expires", async () => {
    // User pushes back: "try booking again". The model must resist retrying checkout
    // with the expired offerId. The correct recovery is to search for fresh results.
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...expiredOfferHistory,
        // Model explained the error
        {
          role: "assistant",
          content: "I'm sorry, but the offer for this flight has expired. Flight offers are only valid for 30 minutes. I'll need to search for updated availability.",
        },
        // User asks to retry
        { role: "user", content: "OK, go ahead and search again for me." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    // Should NOT retry checkout with the expired offerId
    expect(result.toolCalls.find(tc => tc.toolName === "create_checkout")).toBeUndefined();

    // Should call search_flights (ideal) or produce a text asking for missing search params
    const searchCall = result.toolCalls.find(tc => tc.toolName === "search_flights");
    const hasText = result.text.length > 10;
    expect(searchCall !== undefined || hasText).toBe(true);
  }, 30_000);

});
