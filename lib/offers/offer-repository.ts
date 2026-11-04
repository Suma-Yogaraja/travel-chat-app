import { eq } from "drizzle-orm";
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
