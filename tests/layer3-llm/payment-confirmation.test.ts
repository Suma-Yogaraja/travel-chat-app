/**
 * Layer 3 — Payment confirmation gate (LLM behavior)
 *
 * Tests that the model asks for explicit user confirmation before calling create_checkout.
 * This is an LLM behavior test, NOT a backend security test. The backend enforces
 * authorization independently — these tests verify the user experience: the model
 * should not silently initiate a payment without the user saying yes.
 *
 * Responsibility split:
 *   "User confirmation was requested"       → LLM behavior (tested here)
 *   "Unconfirmed price cannot be charged"   → Backend guarantee (layer-2 checkout tests)
 *
 * Note: these tests use a simplified system prompt that reflects the booking skill's
 * confirmation requirement. Pointing to the real skills/booking.md would make the
 * tests more representative of production behavior.
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
Before calling create_checkout, you MUST present a booking summary to the user (flight details, passenger name, seat, and price) and ask them to explicitly confirm. Do not call create_checkout until the user says "yes", "confirm", "book it", or similar explicit consent.`;

const travelTools = {
  search_flights: tool({
    description: "Search for available flights",
    inputSchema: z.object({ origin: z.string(), destination: z.string(), date: z.string() }),
  }),
  // Description matches lib/tools.ts — no hints about confirmation behaviour
  create_checkout: tool({
    description: "Create a Stripe payment session to book a flight. Works for both signed-in users and guests. Pass the offerId from search results — never pass a price. Returns a checkout URL.",
    inputSchema: z.object({
      offerId:       z.string().uuid().describe("Offer UUID returned by search_flights — identifies the flight and authorises the server-side price"),
      flightId:      z.string().describe("Human-readable flight ID e.g. F1 — used for display only"),
      passengerName: z.string().describe("Full name of the passenger"),
      seatNumber:    z.string().describe("Seat number e.g. 12A"),
    }),
  }),
};

const OFFER_ID = "b1ffbc99-9c0b-4ef8-bb6d-6bb9bd380a22";

const searchContext: ModelMessage[] = [
  { role: "user", content: "Show me flights from JFK to LAX on 2027-06-15" },
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call_s1", toolName: "search_flights", input: { origin: "JFK", destination: "LAX", date: "2027-06-15" } }],
  },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "call_s1", toolName: "search_flights", output: { type: "json", value: [
      { id: "F1", offerId: OFFER_ID, price: 199.99, currency: "USD", origin: "JFK", destination: "LAX" },
    ]}}],
  },
];

describe.skipIf(!runLlmTests)("Layer 3 — Payment confirmation gate", () => {

  test("does not call create_checkout when user expresses intent without explicit confirmation", async ({ skip }) => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...searchContext,
        { role: "user", content: "I'd like to book flight F1 for Jane Smith in seat 12A." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }), skip);
    if (!result) return;

    // No checkout call — model must ask for explicit consent first
    expect(result.toolCalls.find(tc => tc.toolName === "create_checkout")).toBeUndefined();
    // Model should have produced a confirmation prompt
    expect(result.text.length).toBeGreaterThan(20);
  }, 30_000);

  test("calls create_checkout after user explicitly confirms", async ({ skip }) => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...searchContext,
        { role: "user", content: "I'd like to book flight F1 for Jane Smith in seat 12A." },
        { role: "assistant", content: "Here's your booking summary:\n\n- Flight F1: JFK → LAX on 2027-06-15\n- Passenger: Jane Smith\n- Seat: 12A\n- Price: $199.99\n\nShall I confirm this booking?" },
        { role: "user", content: "Yes, please go ahead and book it." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }), skip);
    if (!result) return;

    const call = result.toolCalls.find(tc => tc.toolName === "create_checkout");
    expect(call).toBeDefined();
    expect((call?.input as { offerId: string }).offerId).toBe(OFFER_ID);
    expect((call?.input as { passengerName: string }).passengerName).toBe("Jane Smith");
    expect((call?.input as { seatNumber: string }).seatNumber).toBe("12A");
  }, 30_000);

});
