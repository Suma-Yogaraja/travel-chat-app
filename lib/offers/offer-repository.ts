import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db/index";
import { flightOffers } from "@/lib/db/schema";

export type NewFlightOffer = typeof flightOffers.$inferInsert;
export type FlightOffer   = typeof flightOffers.$inferSelect;

export async function insertFlightOffer(data: NewFlightOffer): Promise<FlightOffer> {
  const [row] = await db.insert(flightOffers).values(data).returning();
  return row;
}

export async function getFlightOfferById(id: string): Promise<FlightOffer | null> {
  const [row] = await db.select().from(flightOffers).where(eq(flightOffers.id, id));
  return row ?? null;
}

export async function updateFlightOfferSeatPrices(
  id: string,
  seatPrices: Record<string, number>,
): Promise<void> {
  await db.update(flightOffers).set({ seatPrices }).where(eq(flightOffers.id, id));
}

// Finds the most recent offer for a given internal flight ID (e.g. "DF-JFK-LHR-2026-12-05-0")
// scoped to the user/guest who owns it. Used to persist seat prices after get_flight_seats.
export async function getFlightOfferByFlightId(
  flightId: string,
  context: { userId?: string | null; guestSessionId?: string | null },
): Promise<FlightOffer | null> {
  const ownerCondition = context.userId
    ? eq(flightOffers.ownerUserId, context.userId)
    : context.guestSessionId
      ? eq(flightOffers.guestSessionId, context.guestSessionId)
      : undefined;

  const conditions = [
    sql`${flightOffers.segments}->>'id' = ${flightId}`,
    ...(ownerCondition ? [ownerCondition] : []),
  ];

  const [row] = await db
    .select()
    .from(flightOffers)
    .where(and(...conditions))
    .orderBy(desc(flightOffers.createdAt))
    .limit(1);

  return row ?? null;
}
