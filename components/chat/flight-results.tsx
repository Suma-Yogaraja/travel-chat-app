"use client";

interface Flight {
  id: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  price: number;
  aircraft: string;
  availableSeats: number;
  offerId?: string; // UUID from server — present after search_flights persists the offer
}

interface FlightResultsProps {
  flights: Flight[];
  onSelectFlight: (flightId: string, offerId: string | undefined) => void;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function FlightResults({ flights, onSelectFlight }: FlightResultsProps) {
  if (!flights.length) return null;

  const origin = flights[0].origin;
  const destination = flights[0].destination;

  return (
    <div className="w-full max-w-2xl space-y-2">
      <p className="text-xs font-medium uppercase tracking-widest text-[#555] mb-3">
        {flights.length} flight{flights.length !== 1 ? "s" : ""} · {origin} → {destination}
      </p>
      {flights.map(flight => (
        <button
          key={flight.id}
          onClick={() => onSelectFlight(flight.id, flight.offerId)}
          className="w-full text-left rounded-xl border border-[#1e1e1e] bg-[#0f0f0f] px-4 py-4 hover:border-[#2a2a2a] hover:bg-[#141414] transition-all group"
        >
          <div className="flex items-center justify-between gap-4">
            {/* Times */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-center">
                <p className="text-xl font-semibold tabular-nums text-white">{flight.departureTime}</p>
                <p className="text-xs text-[#555]">{flight.origin}</p>
              </div>
              <div className="flex flex-col items-center gap-1 px-2">
                <p className="text-[10px] text-[#444] tabular-nums">{formatDuration(flight.durationMinutes)}</p>
                <div className="flex items-center gap-1">
                  <div className="h-px w-8 bg-[#2a2a2a]" />
                  <div className="h-1 w-1 rounded-full bg-[#444]" />
                  <div className="h-px w-8 bg-[#2a2a2a]" />
                </div>
                <p className="text-[10px] text-[#444]">{flight.aircraft}</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold tabular-nums text-white">{flight.arrivalTime}</p>
                <p className="text-xs text-[#555]">{flight.destination}</p>
              </div>
            </div>

            {/* Price + seats */}
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <p className="text-xl font-semibold text-white">${flight.price}</p>
              <p className="text-xs text-[#555]">{flight.availableSeats} seats left</p>
              <p className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                Select →
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
