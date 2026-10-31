"use client";

interface Seat {
  seatNumber: string;
  row: number;
  column: string;
  type: "window" | "aisle" | "middle";
  available: boolean;
}

interface SeatMapProps {
  seats: Seat[];
  flightId: string;
  onSelectSeat?: (seatNumber: string) => void;
}

const COLUMNS = ["A", "B", "C", "D", "E", "F"];

export function SeatMap({ seats, flightId, onSelectSeat }: SeatMapProps) {
  const rows = Array.from(new Set(seats.map(s => s.row))).sort((a, b) => a - b);

  function getSeat(row: number, col: string) {
    return seats.find(s => s.row === row && s.column === col);
  }

  return (
    <div className="mt-2 rounded-xl bg-gray-900 border border-gray-700 p-4 w-fit">
      <p className="text-xs text-gray-500 mb-3">
        Flight {flightId} — click an available seat to select it
      </p>

      {/* Column headers */}
      <div className="flex items-center gap-1 mb-2 ml-7">
        {COLUMNS.map((col, i) => (
          <div key={col}>
            {i === 3 && <span className="w-3 inline-block" />}
            <span className="w-7 text-center text-[10px] text-gray-500 font-mono">{col}</span>
          </div>
        ))}
      </div>

      {/* Seat rows */}
      <div className="space-y-1">
        {rows.map(row => (
          <div key={row} className="flex items-center gap-1">
            {/* Row number */}
            <span className="w-6 text-right text-[10px] text-gray-600 font-mono mr-1">{row}</span>

            {COLUMNS.map((col, i) => {
              const seat = getSeat(row, col);
              if (!seat) return null;

              const isWindow = col === "A" || col === "F";
              const isAisle = col === "C" || col === "D";

              let bg = "bg-gray-700 cursor-not-allowed opacity-50"; // taken
              if (seat.available) {
                bg = isWindow
                  ? "bg-blue-600 hover:bg-blue-500 cursor-pointer"
                  : isAisle
                  ? "bg-green-600 hover:bg-green-500 cursor-pointer"
                  : "bg-teal-600 hover:bg-teal-500 cursor-pointer";
              }

              return (
                <div key={col}>
                  {/* Aisle gap between C and D */}
                  {i === 3 && <span className="w-3 inline-block" />}
                  <button
                    disabled={!seat.available || !onSelectSeat}
                    onClick={() => onSelectSeat?.(seat.seatNumber)}
                    title={`${seat.seatNumber} — ${seat.type}${seat.available ? "" : " (taken)"}`}
                    className={`w-7 h-7 rounded text-[10px] font-mono text-white transition-colors ${bg}`}
                  >
                    {seat.seatNumber}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mt-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600 inline-block" /> Window</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-600 inline-block" /> Aisle</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-600 inline-block" /> Middle</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-700 opacity-50 inline-block" /> Taken</span>
      </div>
    </div>
  );
}
