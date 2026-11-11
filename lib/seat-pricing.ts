// Pure deterministic function for mock provider seat surcharges.
// Used when building the seat map AND as a fallback in create_checkout / change_seat
// if seat prices weren't persisted from a previous get_flight_seats call.
export function mockSeatSurchargeMinor(seatNumber: string): number {
  const rowMatch = seatNumber.match(/^(\d+)/);
  const colMatch = seatNumber.match(/([A-Za-z]+)$/);
  if (!rowMatch || !colMatch) return 0;
  const row = parseInt(rowMatch[1]);
  const col = colMatch[1].toUpperCase();
  const frontBonus = row <= 5 ? 2000 : 0;           // rows 1-5: +$20
  const colPrice =
    col === "A" || col === "F" ? 3000 :              // window: +$30
    col === "C" || col === "D" ? 1500 : 0;           // aisle: +$15, middle: free
  return frontBonus + colPrice;
}
