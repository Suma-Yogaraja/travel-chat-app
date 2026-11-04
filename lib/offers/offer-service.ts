import type { McpContext } from "@/lib/mcp-bridge";
import type { Flight } from "@/lib/flight-provider/index";
import { insertFlightOffer, getFlightOfferById } from "./offer-repository";
import type { FlightOffer } from "./offer-repository";

// Number of decimal places for each currency's minor unit.
// JPY has no subunit (exponent 0), BHD has 3 (fils), most others have 2 (cents).
const CURRENCY_EXPONENT: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2,
  CHF: 2, SEK: 2, NOK: 2, DKK: 2, SGD: 2, HKD: 2,
  JPY: 0, KRW: 0,
  BHD: 3, KWD: 3, OMR: 3,
};

export function toMinorUnits(amount: number, currency: string): number {
  const exp = CURRENCY_EXPONENT[currency.toUpperCase()] ?? 2;
  return Math.round(amount * Math.pow(10, exp));
}

export function fromMinorUnits(minor: number, currency: string): number {
  const exp = CURRENCY_EXPONENT[currency.toUpperCase()] ?? 2;
  return minor / Math.pow(10, exp);
}

export async function persistFlightOffer(
  flight: Flight,
  context: McpContext,
): Promise<string> {
  const currency = flight.currency ?? "USD";
  const provider = process.env.FLIGHT_PROVIDER === "duffel" ? "duffel" : "mock";

  // Offers expire in 30 minutes — matches Stripe checkout session expiry
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  // Build a full departure timestamp from date + departureTime
  const departureAt = new Date(`${flight.date}T${flight.departureTime}:00`);

  const row = await insertFlightOffer({
    provider,
    providerOfferId: flight.providerOfferId ?? null,
    ownerUserId:     context.userId ?? null,
    guestSessionId:  context.guestSessionId ?? null,
    origin:          flight.origin,
    destination:     flight.destination,
    departureAt,
    cabinClass:      "economy",
    segments:        flight as unknown as Record<string, unknown>,
    priceMinor:      toMinorUnits(flight.price, currency),
    currency,
    expiresAt,
  });

  return row.id;
}

export type RevalidationResult =
  | { valid: true;  priceMinor: number; currency: string; priceChanged: boolean; previousPriceMinor: number }
  | { valid: false; reason: "expired" | "not_found" | "provider_unavailable" };

export async function validateOfferForCheckout(
  offerId: string,
  context: McpContext,
): Promise<RevalidationResult & { offer?: FlightOffer }> {
  const offer = await getFlightOfferById(offerId);
  if (!offer) return { valid: false, reason: "not_found" };
  if (offer.expiresAt < new Date()) return { valid: false, reason: "expired" };

  // For Duffel offers, re-validate price with the provider before charging.
  // Fail closed: if Duffel is unreachable, never charge the stale stored price.
  if (offer.provider === "duffel" && offer.providerOfferId) {
    const live = await fetchDuffelOfferPrice(offer.providerOfferId);
    if (!live) return { valid: false, reason: "provider_unavailable" };

    const liveMinor = toMinorUnits(parseFloat(live.total_amount), live.total_currency);
    const priceChanged = liveMinor !== offer.priceMinor;
    return { valid: true, priceMinor: liveMinor, currency: live.total_currency, priceChanged, previousPriceMinor: offer.priceMinor, offer };
  }

  // Mock / no providerOfferId — trust stored price
  return { valid: true, priceMinor: offer.priceMinor, currency: offer.currency, priceChanged: false, previousPriceMinor: offer.priceMinor, offer };
}

async function fetchDuffelOfferPrice(
  duffelOfferId: string,
): Promise<{ total_amount: string; total_currency: string } | null> {
  try {
    const res = await fetch(`https://api.duffel.com/air/offers/${encodeURIComponent(duffelOfferId)}`, {
      headers: {
        Authorization: `Bearer ${process.env.DUFFEL_API_KEY}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const d = body.data;
    if (!d?.total_amount || !d?.total_currency) return null;
    return { total_amount: d.total_amount, total_currency: d.total_currency };
  } catch {
    return null;
  }
}
