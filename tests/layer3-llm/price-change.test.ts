/**
 * Layer 3 — Price change handling (LLM behavior)
 *
 * Tests that the model correctly handles PRICE_CHANGED responses from the backend.
 * This is a layered guarantee:
 *   Backend guarantee: the priceChangeToken is HMAC-signed and expires; the backend
 *     will reject a checkout that omits the token or uses a stale one.
 *   LLM behavior (tested here): the model must respect the user's decision. If the
 *     user declines the new price, the model must NOT retry create_checkout.
 *
 * These tests verify the model's decision-making, not the token's cryptographic validity.
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
When create_checkout returns a PRICE_CHANGED error, clearly tell the user the original price and new price, and ask if they want to proceed at the new price.
If the user declines, do not call create_checkout again.
If the user accepts, call create_checkout again and pass the priceChangeToken exactly as returned — do not modify it.`;

const travelTools = {
  create_checkout: tool({
    description: "Create a Stripe payment session. When retrying after a PRICE_CHANGED error, include priceChangeToken.",
    inputSchema: z.object({
      offerId:          z.string().uuid(),
      flightId:         z.string(),
      passengerName:    z.string(),
      seatNumber:       z.string(),
      priceChangeToken: z.string().optional().describe("Token from a PRICE_CHANGED error — pass verbatim to confirm accepted price"),
    }),
  }),
};

const OFFER_ID = "c2aabc99-9c0b-4ef8-bb6d-6bb9bd380a33";
const PRICE_CHANGE_TOKEN = "hmac.signed.token.abc123def456";

// Shared: user asked to book → model called create_checkout → backend returned PRICE_CHANGED
const priceChangedHistory: ModelMessage[] = [
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
          error: "PRICE_CHANGED",
          message: "The fare price has changed since you searched.",
          originalPriceUsd: 199.99,
          newPriceUsd: 229.99,
          currency: "USD",
          priceChangeToken: PRICE_CHANGE_TOKEN,
        }},
      },
    ],
  },
];

describe.skipIf(!runLlmTests)("Layer 3 — Price change handling", () => {

  test("does not retry checkout when user declines the new price", async () => {
    // The model communicated the price change, the user says no.
    // The model must respect this decision and not call create_checkout again.
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...priceChangedHistory,
        // Model explains the price change to the user
        {
          role: "assistant",
          content: "The price for this flight has changed from $199.99 to $229.99. Would you like to proceed at the new price?",
        },
        // User declines
        { role: "user", content: "No, $229.99 is too expensive. Cancel the booking." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    // Model must not retry checkout after user declines
    expect(result.toolCalls.find(tc => tc.toolName === "create_checkout")).toBeUndefined();
    // Model should acknowledge the cancellation in text
    expect(result.text.length).toBeGreaterThan(10);
  }, 30_000);

  test("retries checkout with priceChangeToken when user accepts the new price", async () => {
    // The model communicated the price change, the user accepts.
    // The model must call create_checkout again and pass the priceChangeToken verbatim.
    // This is what the backend uses to validate that the user saw and accepted the new price.
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages: [
        ...priceChangedHistory,
        {
          role: "assistant",
          content: "The price for this flight has changed from $199.99 to $229.99. Would you like to proceed at the new price?",
        },
        // User accepts
        { role: "user", content: "Yes, that's fine. Please go ahead and book at the new price." },
      ],
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    const retryCall = result.toolCalls.find(tc => tc.toolName === "create_checkout");
    expect(retryCall).toBeDefined();

    const args = retryCall?.input as Record<string, string>;
    // Must carry the original offerId
    expect(args.offerId).toBe(OFFER_ID);
    // Must pass the priceChangeToken back — this is the backend's consent signal
    expect(args.priceChangeToken).toBe(PRICE_CHANGE_TOKEN);
  }, 30_000);

});
