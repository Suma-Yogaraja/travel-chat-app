export interface Flight {
  id: string;
  origin: string;
  destination: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  price: number;
  aircraft: string;
  availableSeats: number;
}

export interface Seat {
  seatNumber: string;
  row: number;
  column: string;
  type: "window" | "middle" | "aisle";
  available: boolean;
}

export interface Booking {
  bookingId: string;
  flightId: string;
  passengerName: string;
  seat: string;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

export interface FlightProvider {
  searchFlights(params: { origin: string; destination: string; date: string }): Flight[];
  getFlightSeats(flightId: string): Seat[];
  bookFlight(params: { flightId: string; passengerName: string; seatNumber: string }): Booking;
  getBooking(bookingId: string): Booking;
  changeSeat(params: { bookingId: string; newSeat: string }): Booking;
}

export function getProvider(): FlightProvider {
  // Swap to AmadeusProvider when FLIGHT_PROVIDER=amadeus
  if (process.env.FLIGHT_PROVIDER === "amadeus") {
    throw new Error("AmadeusProvider not yet implemented — set FLIGHT_PROVIDER=mock");
  }
  const { MockProvider } = require("./mock-provider");
  return new MockProvider();
}
