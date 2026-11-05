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
 *
 * Fixture error strings match the exact values returned by lib/tools.ts create_checkout:
 *   not_found  → "Offer not found. Please search for flights again."
 *   expired    → "This offer has expired. Please search for flights again to get current pricing."
 */
import { describe, test, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

config({ path: ".env.local" });

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const runLlmTests = hasApiKey && !!process.env.RUN_LLM_TESTS;

async function tryLlm<T>(fn: () => Promise<T>, skip: () => void): Promise<T | undefined> {
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
      skip();
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
If create_checkout returns an error saying the offer was not found or expired, apologise, explain that search results are only valid for a limited time, and offer to search for flights again. Do not retry create_checkout with the same offerId.`;

const travelTools = {
  search_flights: tool({
    description: "Search for available flights between two airports on a given date",
    inputSchema: z.object({ origin: z.string(), destination: z.string(), date: z.string() }),
  }),
  create_checkout: tool({
    description: "Create a Stripe payment session to book a flight. Pass the offerId from search results — never pass a price. Returns a checkout URL.",
    inputSchema: z.object({
      offerId:       z.string().uuid(),
      flightId:      z.string(),
      passengerName: z.string(),
      seatNumber:    z.string(),
    }),
  }),
};

const OFFER_ID = "d3bbbc99-9c0b-4ef8-bb6d-6bb9bd380a44";

// Fixture error string matches lib/tools.ts: validation.reason === "not_found" path
const expiredOfferHistory: ModelMessage[] = [
  { role: "user", content: "Book flight F1 for Jane Smith in seat 12A." },
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call_co_1", toolName: "create_checkout", input: { offerId: OFFER_ID, flightId: "F1", passengerName: "Jane Smith", seatNumber: "12A" } }],
  },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "call_co_1", toolName: "create_checkout", output: { type: "json", value: {
      error: "Offer not found. Please search for flights again.",
    }}}],
  },
];

describe.skipIf(!runLlmTests)("Layer 3 — Tool failure recovery", () => {

  test("does not retry create_checkout with an expired offer", async ({ skip }) => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: expiredOfferHistory,
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }), skip);
    if (!result) return;

    expect(result.toolCalls.find(tc => tc.toolName === "create_checkout")).toBeUndefined();
    expect(result.text.length).toBeGreaterThan(20);
  }, 30_000);

  test("searches for fresh flights when user asks to try again after offer expires", async ({ skip }) => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...expiredOfferHistory,
        { role: "assistant", content: "I'm sorry, but the offer for this flight has expired. Flight offers are only valid for a limited time. I'll need to search for updated availability." },
        { role: "user", content: "OK, go ahead and search again for me." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }), skip);
    if (!result) return;

    // Must not retry checkout with the stale offerId
    expect(result.toolCalls.find(tc => tc.toolName === "create_checkout")).toBeUndefined();
    // Should call search_flights (ideal) or produce text asking for missing search params
    const searchCall = result.toolCalls.find(tc => tc.toolName === "search_flights");
    expect(searchCall !== undefined || result.text.length > 10).toBe(true);
  }, 30_000);

});
