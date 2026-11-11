import type { Flight, Seat, Booking, FlightProvider } from "./index";
import { mockSeatSurchargeMinor } from "@/lib/seat-pricing";

const FLIGHTS: Flight[] = [
  { id: "F1",  origin: "JFK", destination: "LAX", date: "2026-11-05", departureTime: "06:00", arrivalTime: "09:30", durationMinutes: 330, price: 199, currency: "USD", aircraft: "Boeing 737",  availableSeats: 12 },
  { id: "F2",  origin: "JFK", destination: "LAX", date: "2026-11-05", departureTime: "10:00", arrivalTime: "13:45", durationMinutes: 345, price: 249, currency: "USD", aircraft: "Airbus A320", availableSeats: 8  },
  { id: "F3",  origin: "JFK", destination: "LAX", date: "2026-11-05", departureTime: "16:30", arrivalTime: "20:00", durationMinutes: 330, price: 179, currency: "USD", aircraft: "Boeing 737",  availableSeats: 20 },
  { id: "F4",  origin: "LAX", destination: "JFK", date: "2026-11-05", departureTime: "07:00", arrivalTime: "15:30", durationMinutes: 330, price: 209, currency: "USD", aircraft: "Boeing 757",  availableSeats: 5  },
  { id: "F5",  origin: "LAX", destination: "JFK", date: "2026-11-05", departureTime: "14:00", arrivalTime: "22:15", durationMinutes: 315, price: 189, currency: "USD", aircraft: "Airbus A321", availableSeats: 15 },
  { id: "F6",  origin: "JFK", destination: "ORD", date: "2026-11-05", departureTime: "08:00", arrivalTime: "10:00", durationMinutes: 120, price: 129, currency: "USD", aircraft: "Boeing 737",  availableSeats: 22 },
  { id: "F7",  origin: "ORD", destination: "JFK", date: "2026-11-05", departureTime: "12:00", arrivalTime: "15:30", durationMinutes: 150, price: 139, currency: "USD", aircraft: "Airbus A319", availableSeats: 18 },
  { id: "F8",  origin: "JFK", destination: "MIA", date: "2026-11-05", departureTime: "09:00", arrivalTime: "12:00", durationMinutes: 180, price: 149, currency: "USD", aircraft: "Boeing 737",  availableSeats: 10 },
  { id: "F9",  origin: "SFO", destination: "JFK", date: "2026-11-05", departureTime: "08:30", arrivalTime: "17:00", durationMinutes: 330, price: 229, currency: "USD", aircraft: "Airbus A320", availableSeats: 7  },
  { id: "F10", origin: "JFK", destination: "SFO", date: "2026-11-05", departureTime: "11:00", arrivalTime: "14:30", durationMinutes: 330, price: 219, currency: "USD", aircraft: "Boeing 757",  availableSeats: 14 },
];

function buildSeatMap(flightId: string): Seat[] {
  const seats: Seat[] = [];
  // Rows 1-10, columns A-F
  const takenSeeds: Record<string, string[]> = {
    F1:  ["1A","1B","2C","3D","5A","7F"],
    F2:  ["1A","1C","1D","2A","2B","3F","4E"],
    F3:  [],
    F4:  ["1A","1B","1C","1D","1E","1F","2A","2B","2C"],
    F5:  ["1A","2B","3C","4D"],
    F6:  [],
    F7:  ["1A","1F","2C","2D"],
    F8:  ["1A","1B","2F","3A","3B","3C"],
    F9:  ["1A","1B","1C","1D","1E","1F","2A","2B"],
    F10: ["1A","3C","5F"],
  };
  const taken = new Set(takenSeeds[flightId] ?? []);

  for (let row = 1; row <= 10; row++) {
    for (const col of ["A","B","C","D","E","F"]) {
      const seatNumber = `${row}${col}`;
      const type = (col === "A" || col === "F") ? "window"
                 : (col === "C" || col === "D") ? "aisle"
                 : "middle";
      const surchargeMinor = mockSeatSurchargeMinor(seatNumber);
      seats.push({
        seatNumber, row, column: col, type,
        available: !taken.has(seatNumber),
        ...(surchargeMinor > 0 ? { price: surchargeMinor / 100, currency: "USD" } : {}),
      });
    }
  }
  return seats;
}

export class MockProvider implements FlightProvider {
  // Instance-level so each new MockProvider() (e.g. in tests) starts clean
  private bookings = new Map<string, Booking>();
  private bookingCounter = 0;
  async searchFlights({ origin, destination }: { origin: string; destination: string; date: string }): Promise<Flight[]> {
    return FLIGHTS.filter(
      f =>
        f.origin.toUpperCase() === origin.toUpperCase() &&
        f.destination.toUpperCase() === destination.toUpperCase()
    );
  }

  async getFlightSeats(flightId: string): Promise<Seat[]> {
    const flight = FLIGHTS.find(f => f.id === flightId);
    if (!flight) throw new Error(`Flight ${flightId} not found`);
    return buildSeatMap(flightId);
  }

  async bookFlight({ flightId, passengerName, seatNumber }: { flightId: string; passengerName: string; seatNumber: string }): Promise<Booking> {
    const flight = FLIGHTS.find(f => f.id === flightId);
    if (!flight) throw new Error(`Flight ${flightId} not found`);

    const seats = buildSeatMap(flightId);
    const seat = seats.find(s => s.seatNumber === seatNumber);
    if (!seat) throw new Error(`Seat ${seatNumber} does not exist on flight ${flightId}`);
    if (!seat.available) throw new Error(`Seat ${seatNumber} is not available`);

    // Also check runtime bookings — buildSeatMap only knows hardcoded seeds
    const runtimeTaken = [...this.bookings.values()].some(
      b => b.flightId === flightId && b.seat === seatNumber
    );
    if (runtimeTaken) throw new Error(`Seat ${seatNumber} is not available`);

    // Mark seat as taken by adding to the booking store
    // Include a random suffix so IDs are unique across Vercel cold starts
    // (the in-memory counter resets on every new function instance)
    const bookingId = `BK-${Date.now()}-${(++this.bookingCounter).toString().padStart(3, "0")}`;
    const booking: Booking = {
      bookingId,
      flightId,
      passengerName,
      seat: seatNumber,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    this.bookings.set(bookingId, booking);
    return booking;
  }

  async getBooking(bookingId: string): Promise<Booking> {
    const booking = this.bookings.get(bookingId);
    if (!booking) throw new Error(`Booking ${bookingId} not found`);
    return booking;
  }

  async changeSeat({ bookingId, newSeat }: { bookingId: string; newSeat: string }): Promise<Booking> {
    const booking = this.bookings.get(bookingId);
    if (!booking) throw new Error(`Booking ${bookingId} not found`);

    const seats = buildSeatMap(booking.flightId);
    const seat = seats.find(s => s.seatNumber === newSeat);
    if (!seat) throw new Error(`Seat ${newSeat} does not exist`);

    // Check if another booking has this seat
    const alreadyTaken = [...this.bookings.values()].some(
      b => b.bookingId !== bookingId && b.flightId === booking.flightId && b.seat === newSeat
    );
    // Also check the hardcoded taken seats in the seat map
    if (!seat.available || alreadyTaken) throw new Error(`Seat ${newSeat} is not available`);

    const updated: Booking = { ...booking, seat: newSeat };
    this.bookings.set(bookingId, updated);
    return updated;
  }
}
