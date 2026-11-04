// Utility functions for trimming/summarising tool results in chat history.
// Extracted from app/api/chat/route.ts so the logic is independently testable.

// Builds the trimmed placeholder for a search_flights tool result.
// The placeholder intentionally preserves offer IDs so that Claude can pass
// them to create_checkout in a later turn without carrying the full payload.
// If this function drops offer IDs, the booking flow silently breaks.
export function searchFlightsPlaceholder(output: unknown): string {
  if (!Array.isArray(output)) return "[Flight results already shown to user]";

  const offerMap = output
    .filter((f): f is Record<string, unknown> => f !== null && typeof f === "object")
    .filter(f => f.offerId)
    .map(f => `${f.id}=${f.offerId}`)
    .join(", ");

  return offerMap
    ? `[Flights shown. Offer IDs: ${offerMap}]`
    : "[Flight results already shown to user]";
}
