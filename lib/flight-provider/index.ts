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
  searchFlights(params: { origin: string; destination: string; date: string }): Promise<Flight[]>;
  getFlightSeats(flightId: string): Promise<Seat[]>;
  bookFlight(params: { flightId: string; passengerName: string; seatNumber: string }): Promise<Booking>;
  getBooking(bookingId: string): Promise<Booking>;
  changeSeat(params: { bookingId: string; newSeat: string }): Promise<Booking>;
}

import { MockProvider } from "./mock-provider";
import { DuffelProvider } from "./duffel-provider";

export function getProvider(): FlightProvider {
  if (process.env.FLIGHT_PROVIDER === "duffel") {
    return new DuffelProvider();
  }
  return new MockProvider();
}
