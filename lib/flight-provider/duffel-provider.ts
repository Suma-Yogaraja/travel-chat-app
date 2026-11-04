import type { Flight, Seat, Booking, FlightProvider } from "./index";

const BASE_URL = "https://api.duffel.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.DUFFEL_API_KEY}`,
    "Content-Type": "application/json",
    "Duffel-Version": "v2",
    Accept: "application/json",
  };
}

interface DuffelSegment {
  departing_at: string;
  arriving_at: string;
  origin: { iata_code: string };
  destination: { iata_code: string };
  marketing_carrier: { iata_code: string; name: string };
  marketing_carrier_flight_number: string;
  aircraft?: { iata_code: string; name: string };
}

interface DuffelSlice {
  duration: string;
  segments: DuffelSegment[];
}

interface DuffelOffer {
  id: string;
  slices: DuffelSlice[];
  total_amount: string;
  total_currency: string;
}

interface DuffelSeatElement {
  type: string;
  designator?: string;
  available_services?: unknown[];
}

interface DuffelSeatMap {
  cabins?: Array<{
    rows: Array<{
      sections: Array<{
        elements: DuffelSeatElement[];
      }>;
    }>;
  }>;
}

export class DuffelProvider implements FlightProvider {
  // Duffel offer ID keyed by our internal flight ID — needed for seatmap calls
  private offerIdCache = new Map<string, string>();

  async searchFlights({
    origin,
    destination,
    date,
  }: {
    origin: string;
    destination: string;
    date: string;
  }): Promise<Flight[]> {
    const res = await fetch(`${BASE_URL}/air/offer_requests`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        data: {
          slices: [
            {
              origin: origin.toUpperCase(),
              destination: destination.toUpperCase(),
              departure_date: date,
            },
          ],
          passengers: [{ type: "adult" }],
          return_offers: true,
          cabin_class: "economy",
        },
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.errors?.[0]?.message ?? res.statusText;
      // 422 = no routes found for this pair — not a crash
      if (res.status === 422) return [];
      throw new Error(`Duffel search failed (${res.status}): ${msg}`);
    }

    const body = await res.json();
    const offers: DuffelOffer[] = body.data?.offers ?? [];

    return offers.slice(0, 10).map((offer, i) => {
      const internalId = `DF-${origin.toUpperCase()}-${destination.toUpperCase()}-${date}-${i}`;
      this.offerIdCache.set(internalId, offer.id);

      const slice = offer.slices[0];
      const firstSeg = slice.segments[0];
      const lastSeg = slice.segments.at(-1)!;
      const stops = slice.segments.length - 1;
      const carrier = firstSeg.marketing_carrier;
      const aircraftLabel =
        stops > 0
          ? `${carrier.iata_code}${firstSeg.marketing_carrier_flight_number} +${stops} stop${stops > 1 ? "s" : ""}`
          : `${carrier.name} ${firstSeg.marketing_carrier_flight_number}`;

      return {
        id: internalId,
        origin: firstSeg.origin.iata_code,
        destination: lastSeg.destination.iata_code,
        date: firstSeg.departing_at.split("T")[0],
        departureTime: firstSeg.departing_at.split("T")[1].slice(0, 5),
        arrivalTime: lastSeg.arriving_at.split("T")[1].slice(0, 5),
        durationMinutes: parseIsoDuration(slice.duration),
        price: parseFloat(offer.total_amount),
        currency: offer.total_currency,
        providerOfferId: offer.id,
        aircraft: aircraftLabel,
        // Duffel doesn't expose remaining seat count — 9 is a safe placeholder
        availableSeats: 9,
      };
    });
  }

  async getFlightSeats(flightId: string): Promise<Seat[]> {
    let offerId = this.offerIdCache.get(flightId);

    if (!offerId) {
      // Cache miss (server restart / cold start) — re-search using params encoded in the ID.
      // Format: DF-{ORIGIN}-{DESTINATION}-{YYYY-MM-DD}-{INDEX}
      const match = flightId.match(/^DF-([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2})-(\d+)$/);
      if (!match) {
        throw new Error("Seat map unavailable — please search for flights first.");
      }
      const [, origin, destination, date] = match;
      await this.searchFlights({ origin, destination, date });
      offerId = this.offerIdCache.get(flightId);
    }

    if (!offerId) {
      throw new Error("Seat map unavailable — the offer may have expired. Please search for flights again.");
    }

    const res = await fetch(
      `${BASE_URL}/air/seat_maps?offer_id=${encodeURIComponent(offerId)}`,
      { headers: headers() }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const msg = body?.errors?.[0]?.message ?? res.statusText;
      throw new Error(`Duffel seat map failed (${res.status}): ${msg}`);
    }

    const body = await res.json();
    const seatMaps: DuffelSeatMap[] = body.data ?? [];
    if (seatMaps.length === 0) return [];

    return parseSeatMap(seatMaps[0]);
  }

  async bookFlight(): Promise<Booking> {
    throw new Error("Booking is handled by the app — not available in Duffel provider.");
  }

  async getBooking(): Promise<Booking> {
    throw new Error("Booking retrieval is handled by the app — not available in Duffel provider.");
  }

  async changeSeat(): Promise<Booking> {
    throw new Error("Seat changes are handled by the app — not available in Duffel provider.");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseIsoDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;
  return parseInt(match[1] ?? "0") * 60 + parseInt(match[2] ?? "0");
}

function getSeatType(col: string): Seat["type"] {
  if (col === "A" || col === "F") return "window";
  if (col === "C" || col === "D") return "aisle";
  return "middle";
}

function parseSeatMap(seatMap: DuffelSeatMap): Seat[] {
  const seats: Seat[] = [];
  for (const cabin of seatMap.cabins ?? []) {
    for (const row of cabin.rows ?? []) {
      for (const section of row.sections ?? []) {
        for (const element of section.elements ?? []) {
          if (element.type !== "seat" || !element.designator) continue;

          const designator = element.designator; // e.g. "12A"
          const colMatch = designator.match(/[A-Z]+$/);
          const rowMatch = designator.match(/^\d+/);
          if (!colMatch || !rowMatch) continue;

          // In Duffel, available_services empty = seat included in fare (still selectable).
          // A seat element existing in the map means it's physically available.
          // Taken seats are simply absent from the response.
          seats.push({
            seatNumber: designator,
            row: parseInt(rowMatch[0]),
            column: colMatch[0],
            type: getSeatType(colMatch[0]),
            available: true,
          });
        }
      }
    }
  }
  return seats;
}
