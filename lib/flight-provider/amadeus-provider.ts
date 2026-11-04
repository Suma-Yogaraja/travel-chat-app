import type { Flight, Seat, Booking, FlightProvider } from "./index";

const BASE_URL =
  process.env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";

interface AmadeusTokenResponse {
  access_token: string;
  expires_in: number;
}

interface AmadeusSegment {
  departure: { iataCode: string; at: string };
  arrival: { iataCode: string; at: string };
  carrierCode: string;
  number: string;
  aircraft: { code: string };
}

interface AmadeusFlightOffer {
  id: string;
  itineraries: Array<{
    duration: string;
    segments: AmadeusSegment[];
  }>;
  numberOfBookableSeats: number;
  price: { grandTotal?: string; total?: string; currency: string };
}

export class AmadeusProvider implements FlightProvider {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  // Keyed by our internal flight ID — needed to call the seatmap API
  private offerCache = new Map<string, AmadeusFlightOffer>();

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_API_KEY ?? "",
      client_secret: process.env.AMADEUS_API_SECRET ?? "",
    });
    const res = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Amadeus auth failed (${res.status}): ${err}`);
    }
    const data: AmadeusTokenResponse = await res.json();
    this.accessToken = data.access_token;
    // Refresh 30 s before actual expiry
    this.tokenExpiresAt = Date.now() + (data.expires_in - 30) * 1000;
    return this.accessToken;
  }

  async searchFlights({
    origin,
    destination,
    date,
  }: {
    origin: string;
    destination: string;
    date: string;
  }): Promise<Flight[]> {
    const token = await this.authenticate();
    const params = new URLSearchParams({
      originLocationCode: origin.toUpperCase(),
      destinationLocationCode: destination.toUpperCase(),
      departureDate: date,
      adults: "1",
      max: "10",
      currencyCode: "USD",
    });

    const res = await fetch(`${BASE_URL}/v2/shopping/flight-offers?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // 400 from Amadeus usually means no routes found for that pair
    if (res.status === 400) return [];
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Amadeus flight search failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const offers: AmadeusFlightOffer[] = data.data ?? [];

    return offers.map((offer, i) => {
      const internalId = `AM-${origin.toUpperCase()}-${destination.toUpperCase()}-${date}-${i}`;
      this.offerCache.set(internalId, offer);

      const itin = offer.itineraries[0];
      const firstSeg = itin.segments[0];
      const lastSeg = itin.segments.at(-1)!;
      const stops = itin.segments.length - 1;
      const aircraftLabel =
        stops > 0
          ? `${firstSeg.carrierCode}${firstSeg.number} +${stops} stop${stops > 1 ? "s" : ""}`
          : `${firstSeg.carrierCode}${firstSeg.number} (${firstSeg.aircraft.code})`;

      return {
        id: internalId,
        origin: firstSeg.departure.iataCode,
        destination: lastSeg.arrival.iataCode,
        date: firstSeg.departure.at.split("T")[0],
        departureTime: firstSeg.departure.at.split("T")[1].slice(0, 5),
        arrivalTime: lastSeg.arrival.at.split("T")[1].slice(0, 5),
        durationMinutes: parseIsoDuration(itin.duration),
        price: parseFloat(offer.price.grandTotal ?? offer.price.total ?? "0"),
        currency: offer.price.currency ?? "USD",
        aircraft: aircraftLabel,
        availableSeats: offer.numberOfBookableSeats,
      };
    });
  }

  async getFlightSeats(flightId: string): Promise<Seat[]> {
    const offer = this.offerCache.get(flightId);
    if (!offer) {
      throw new Error(
        "Seat map unavailable — please search for flights first, then request seats for a specific flight."
      );
    }

    const token = await this.authenticate();
    const res = await fetch(`${BASE_URL}/v1/shopping/seatmaps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: [offer] }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Amadeus seatmap failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    const seatMaps: AmadeusSeatMap[] = data.data ?? [];
    if (seatMaps.length === 0) return [];

    return parseSeatMap(seatMaps[0]);
  }

  // These three are handled by lib/tools.ts → Postgres in the web app.
  // They exist here only to satisfy the FlightProvider interface (MCP standalone use).
  async bookFlight(): Promise<Booking> {
    throw new Error("Booking is handled by the app — not available in Amadeus provider.");
  }

  async getBooking(): Promise<Booking> {
    throw new Error("Booking retrieval is handled by the app — not available in Amadeus provider.");
  }

  async changeSeat(): Promise<Booking> {
    throw new Error("Seat changes are handled by the app — not available in Amadeus provider.");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseIsoDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;
  return parseInt(match[1] ?? "0") * 60 + parseInt(match[2] ?? "0");
}

interface AmadeusSeat {
  number: string;
  characteristicsCodes?: string[];
  travelerPricing?: Array<{ seatAvailabilityStatus: string }>;
}

interface AmadeusSeatMap {
  cabins?: Array<{
    rows?: Array<{
      seats?: AmadeusSeat[];
    }>;
  }>;
}

function parseSeatMap(seatMapData: AmadeusSeatMap): Seat[] {
  const seats: Seat[] = [];
  for (const cabin of seatMapData.cabins ?? []) {
    for (const row of cabin.rows ?? []) {
      for (const seat of row.seats ?? []) {
        const num = seat.number; // e.g. "12A"
        const colMatch = num.match(/[A-Z]+$/);
        const rowMatch = num.match(/^\d+/);
        if (!colMatch || !rowMatch) continue;

        const col = colMatch[0];
        const rowNum = parseInt(rowMatch[0]);
        const codes = seat.characteristicsCodes ?? [];
        const isAvailable =
          seat.travelerPricing?.[0]?.seatAvailabilityStatus === "AVAILABLE";

        const type: Seat["type"] = codes.includes("W")
          ? "window"
          : codes.includes("A")
          ? "aisle"
          : "middle";

        seats.push({ seatNumber: num, row: rowNum, column: col, type, available: isAvailable });
      }
    }
  }
  return seats;
}
