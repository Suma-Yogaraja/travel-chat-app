/**
 * Layer 3 — LLM integration tests
 *
 * These tests use a real LLM (Haiku) to verify that Claude calls the right
 * tool given natural language input. They cost a few fractions of a cent each.
 * They run automatically when ANTHROPIC_API_KEY is set (local or CI).
 * They skip gracefully when the key is absent.
 */
import { describe, test, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { generateText, tool, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

// Load .env.local so ANTHROPIC_API_KEY is available in local dev
config({ path: ".env.local" });

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

// Minimal tool definitions matching the MCP server schemas.
// We don't need execute — we're only testing that the model calls the right tool.
const travelTools = {
  search_flights: tool({
    description: "Search for available flights between two airports on a given date",
    inputSchema: z.object({
      origin: z.string().describe("Departure airport code e.g. JFK"),
      destination: z.string().describe("Arrival airport code e.g. LAX"),
      date: z.string().describe("Travel date in YYYY-MM-DD format"),
    }),
  }),
  book_flight: tool({
    description: "Book a seat on a specific flight for a passenger",
    inputSchema: z.object({
      flightId: z.string().describe("Flight ID e.g. F1"),
      passengerName: z.string().describe("Full name of the passenger"),
      seatNumber: z.string().describe("Seat number e.g. 12A"),
    }),
  }),
  get_flight_seats: tool({
    description: "Get available seats on a flight",
    inputSchema: z.object({
      flightId: z.string(),
    }),
  }),
  get_booking: tool({
    description: "Get details of an existing booking",
    inputSchema: z.object({
      bookingId: z.string(),
    }),
  }),
  change_seat: tool({
    description: "Change the seat on an existing booking",
    inputSchema: z.object({
      bookingId: z.string(),
      newSeat: z.string(),
    }),
  }),
};

beforeAll(() => {
  if (!hasApiKey) {
    console.warn("ANTHROPIC_API_KEY not set — Layer 3 tests will be skipped.");
  }
});

const SYSTEM = "You are a travel assistant. Always use the available tools to help users — never ask clarifying questions, just call the most appropriate tool with reasonable defaults.";

describe.skipIf(!hasApiKey)("Layer 3 — LLM tool selection", () => {
  test("user asks for flights → Claude calls search_flights", async () => {
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "Find me flights from JFK to LAX on 2026-11-05",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    });

    const toolNames = result.toolCalls.map(tc => tc.toolName);
    expect(toolNames).toContain("search_flights");
  }, 30_000);

  test("user asks to book a flight → Claude calls book_flight", async () => {
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: SYSTEM,
      prompt: "Book flight F1 for passenger Jane Smith in seat 12A",
      tools: travelTools,
      stopWhen: stepCountIs(1),
    });

    const toolNames = result.toolCalls.map(tc => tc.toolName);
    expect(toolNames).toContain("book_flight");
  }, 30_000);
});
