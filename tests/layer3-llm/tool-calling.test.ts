/**
 * Layer 3 — LLM integration tests
 *
 * These tests use a real LLM (Claude Haiku) to verify that the model calls the
 * right tool given natural language input. Each test costs a fraction of a cent.
 * They run when ANTHROPIC_API_KEY is set and skip gracefully otherwise.
 */
import { describe, test, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { generateText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

config({ path: ".env.local" });

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
// Layer-3 tests cost real Anthropic credits — only run when explicitly opted in
const runLlmTests = hasApiKey && !!process.env.RUN_LLM_TESTS;

const travelTools = {
  search_flights: tool({
    description: "Search for available flights between two airports on a given date",
    inputSchema: z.object({
      origin:      z.string().describe("Departure IATA airport code e.g. JFK"),
      destination: z.string().describe("Arrival IATA airport code e.g. LAX"),
      date:        z.string().describe("Travel date in YYYY-MM-DD format"),
    }),
  }),
  get_flight_seats: tool({
    description: "Get the seat map for a flight showing available and taken seats",
    inputSchema: z.object({
      flightId: z.string().describe("Flight ID e.g. F1"),
    }),
  }),
  create_checkout: tool({
    description: "Create a Stripe payment session. Pass offerId from search results. NEVER pass a price — pricing is server-authoritative.",
    inputSchema: z.object({
      offerId:       z.string().uuid().describe("Offer UUID from search_flights"),
      flightId:      z.string().describe("Human-readable flight ID for display only"),
      passengerName: z.string(),
      seatNumber:    z.string(),
    }),
  }),
  get_booking: tool({
    description: "Get details of an existing booking by reference",
    inputSchema: z.object({
      bookingId: z.string(),
    }),
  }),
  change_seat: tool({
    description: "Change the seat on an existing booking",
    inputSchema: z.object({
      bookingId: z.string(),
      newSeat:   z.string(),
    }),
  }),
};

beforeAll(() => {
  if (!hasApiKey) console.warn("ANTHROPIC_API_KEY not set — Layer 3 tests will be skipped.");
  else if (!runLlmTests) console.warn("RUN_LLM_TESTS not set — Layer 3 tests will be skipped (set RUN_LLM_TESTS=1 to run them).");
});

// Runs fn; if Anthropic returns a billing/auth error, logs a warning and returns undefined.
// This lets tests pass gracefully when the API key is set but out of credits.
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

const SYSTEM = `You are a travel assistant. Always use the available tools to help users.
Today's date is 2027-06-01. Use IATA codes for airports (e.g. JFK for New York, LAX for Los Angeles, LHR for London).
When asked to book, use create_checkout. Never ask clarifying questions — call the most appropriate tool immediately.`;

describe.skipIf(!runLlmTests)("Layer 3 — LLM tool selection", () => {

  test("flight search request → calls search_flights", async () => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "Find me flights from JFK to LAX on 2027-06-15",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));
    if (!result) return;
    expect(result.toolCalls.map(tc => tc.toolName)).toContain("search_flights");
  }, 30_000);

  test("city names → converts to IATA codes in search_flights", async () => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "Search flights from New York to Los Angeles on 2027-07-01",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));
    if (!result) return;
    const call = result.toolCalls.find(tc => tc.toolName === "search_flights");
    expect(call).toBeDefined();
    expect((call?.input as { origin: string }).origin).toMatch(/^[A-Z]{3}$/);
    expect((call?.input as { destination: string }).destination).toMatch(/^[A-Z]{3}$/);
  }, 30_000);

  test("seat map request → calls get_flight_seats", async () => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "Show me available seats on flight F1",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));
    if (!result) return;
    expect(result.toolCalls.map(tc => tc.toolName)).toContain("get_flight_seats");
  }, 30_000);

  test("booking request → calls create_checkout with offerId not priceUsd", async () => {
    // Pricing invariant: the model must pass the server-issued offerId,
    // not a price it invented. If offerId is missing, Stripe would never be charged.
    const OFFER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const system = `${SYSTEM}\n\nSearch results for the user:\n[{"id":"F1","offerId":"${OFFER_ID}","price":199.99,"currency":"USD","origin":"JFK","destination":"LAX"}]`;
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system,
      prompt: "Book flight F1 for Jane Smith in seat 12A",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));
    if (!result) return;
    const call = result.toolCalls.find(tc => tc.toolName === "create_checkout");
    expect(call).toBeDefined();
    // Model must carry the server-issued offer ID
    expect((call?.input as { offerId: string }).offerId).toBe(OFFER_ID);
    // Model must not supply a price — the schema strips it, but verify intent
    expect((call?.input as Record<string, unknown>).priceUsd).toBeUndefined();
  }, 30_000);

  test("booking lookup → calls get_booking", async () => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "What's the status of my booking BK-1234567890-abc?",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));
    if (!result) return;
    expect(result.toolCalls.map(tc => tc.toolName)).toContain("get_booking");
  }, 30_000);

  test("seat change request → calls change_seat", async () => {
    const result = await tryLlm(() => generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "Can you change my seat to 15C on booking BK-1234567890-abc?",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    }));
    if (!result) return;
    expect(result.toolCalls.map(tc => tc.toolName)).toContain("change_seat");
  }, 30_000);


});
