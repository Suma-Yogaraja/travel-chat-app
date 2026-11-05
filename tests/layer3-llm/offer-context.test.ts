/**
 * Layer 3 — Offer context retention
 *
 * Tests that the model carries the server-issued offerId correctly across multiple
 * conversation turns. This is an LLM behavior test: if the model loses or invents
 * an offer UUID, the backend will reject the checkout (backend guarantee), but the
 * user experience degrades because the model can't complete the booking.
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
Use IATA codes for airports. When asked to book, use create_checkout with the offerId from search results.`;

const travelTools = {
  search_flights: tool({
    description: "Search for available flights between two airports on a given date",
    inputSchema: z.object({
      origin:      z.string(),
      destination: z.string(),
      date:        z.string(),
    }),
  }),
  get_flight_seats: tool({
    description: "Get the seat map for a flight showing available and taken seats",
    inputSchema: z.object({
      flightId: z.string(),
    }),
  }),
  create_checkout: tool({
    description: "Create a Stripe payment session. Pass offerId from search results. NEVER invent a price.",
    inputSchema: z.object({
      offerId:       z.string().uuid().describe("Offer UUID from search_flights — must be carried verbatim"),
      flightId:      z.string(),
      passengerName: z.string(),
      seatNumber:    z.string(),
    }),
  }),
};

const OFFER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

describe.skipIf(!runLlmTests)("Layer 3 — Offer context retention", () => {

  test("offer UUID is preserved after seat-map turn and additional dialogue", async () => {
    // Builds a 5-message history where search results containing the offerId were shown
    // early in the conversation. After an interleaved seat-map turn and some back-and-forth,
    // the user asks to book. The model must carry the original offerId through to create_checkout.
    const messages: ModelMessage[] = [
      // Turn 1: user searches
      { role: "user", content: "Find flights from JFK to LAX on 2027-06-15" },
      // Turn 2: model calls search and receives results
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_search_1",
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
            toolCallId: "call_search_1",
            toolName: "search_flights",
            output: { type: "json", value: [
              {
                id: "F1",
                offerId: OFFER_ID,
                price: 199.99,
                currency: "USD",
                origin: "JFK",
                destination: "LAX",
                departure: "2027-06-15T08:00:00",
                arrival: "2027-06-15T11:00:00",
                airline: "AA",
              },
            ]},
          },
        ],
      },
      // Turn 3: user asks about seats (interleaved turn — tests context retention)
      { role: "user", content: "What window seats are free on F1?" },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_seats_1",
            toolName: "get_flight_seats",
            input: { flightId: "F1" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_seats_1",
            toolName: "get_flight_seats",
            output: { type: "json", value: [
              { id: "12A", available: true, type: "window" },
              { id: "14A", available: true, type: "window" },
              { id: "12B", available: false, type: "middle" },
            ]},
          },
        ],
      },
      // Turn 4: user picks a seat and asks to book
      { role: "user", content: "Great — book 12A for Jane Smith please." },
    ];

    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      messages,
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));

    if (!result) return;

    const call = result.toolCalls.find(tc => tc.toolName === "create_checkout");
    expect(call).toBeDefined();
    // Core assertion: the original server-issued offer UUID must be preserved verbatim
    expect((call?.input as { offerId: string }).offerId).toBe(OFFER_ID);
  }, 45_000);

});
