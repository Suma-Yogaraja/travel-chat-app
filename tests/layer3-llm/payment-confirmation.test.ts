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

// This system prompt reflects the real booking skill's confirmation requirement.
const SYSTEM = `You are a travel assistant. Today's date is 2027-06-01.
Before calling create_checkout, you MUST present a booking summary to the user (flight details, passenger name, seat, and price) and ask them to explicitly confirm. Do not call create_checkout until the user says "yes", "confirm", "book it", or similar explicit consent.`;

const travelTools = {
  search_flights: tool({
    description: "Search for available flights",
    inputSchema: z.object({
      origin:      z.string(),
      destination: z.string(),
      date:        z.string(),
    }),
  }),
  create_checkout: tool({
    description: "Create a Stripe payment session. Only call after the user has explicitly confirmed.",
    inputSchema: z.object({
      offerId:       z.string().uuid(),
      flightId:      z.string(),
      passengerName: z.string(),
      seatNumber:    z.string(),
    }),
  }),
};

const OFFER_ID = "b1ffbc99-9c0b-4ef8-bb6d-6bb9bd380a22";

// Pre-built search context shared by both tests
const searchContext: ModelMessage[] = [
  { role: "user", content: "Show me flights from JFK to LAX on 2027-06-15" },
  {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: "call_s1",
        toolName: "search_flights",
        input: { origin: "JFK", destination: "LAX", date: "2027-06-15" },
      },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call_s1",
        toolName: "search_flights",
        output: { type: "json", value: [
          { id: "F1", offerId: OFFER_ID, price: 199.99, currency: "USD", origin: "JFK", destination: "LAX" },
        ]},
      },
    ],
  },
];

describe.skipIf(!runLlmTests)("Layer 3 — Payment confirmation gate", () => {

  test("does not call create_checkout when user expresses intent without explicit confirmation", async () => {
    // User provides complete booking details but has NOT said "yes go ahead".
    // The model should respond with a summary and ask for confirmation — not proceed to checkout.
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...searchContext,
        // Complete info, but no explicit "yes" — the model should stop and confirm
        { role: "user", content: "I'd like to book flight F1 for Jane Smith in seat 12A." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    // No checkout call — model must ask for explicit consent first
    const checkoutCall = result.toolCalls.find(tc => tc.toolName === "create_checkout");
    expect(checkoutCall).toBeUndefined();
    // Model should have produced a summary/confirmation prompt as text
    expect(result.text.length).toBeGreaterThan(20);
  }, 30_000);

  test("calls create_checkout after user explicitly confirms", async () => {
    // After the model has shown the booking summary, the user says "yes".
    // The model must proceed to create_checkout with the correct offerId.
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...searchContext,
        { role: "user", content: "I'd like to book flight F1 for Jane Smith in seat 12A." },
        // Model shows booking summary and asks for confirmation
        {
          role: "assistant",
          content: "Here's your booking summary:\n\n- Flight F1: JFK → LAX on 2027-06-15\n- Passenger: Jane Smith\n- Seat: 12A\n- Price: $199.99\n\nShall I confirm this booking?",
        },
        // User explicitly confirms
        { role: "user", content: "Yes, please go ahead and book it." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    const checkoutCall = result.toolCalls.find(tc => tc.toolName === "create_checkout");
    expect(checkoutCall).toBeDefined();
    expect((checkoutCall?.input as { offerId: string }).offerId).toBe(OFFER_ID);
    expect((checkoutCall?.input as { passengerName: string }).passengerName).toBe("Jane Smith");
    expect((checkoutCall?.input as { seatNumber: string }).seatNumber).toBe("12A");
  }, 30_000);

});
