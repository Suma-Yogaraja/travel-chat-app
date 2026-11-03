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

const COLORS = {
  window: { bg: "#1e3a5f", border: "#3a6ab0", hover: "#254d7a" },
  aisle:  { bg: "#1a4a2e", border: "#2a8a4a", hover: "#205a38" },
  middle: { bg: "#2e2e52", border: "#5050a0", hover: "#383868" },
} as const;

function Seat({ seat, onSelect }: { seat: Seat; onSelect?: (s: string) => void }) {
  const c = seat.available ? COLORS[seat.type] : null;

  return (
    <div
      role={seat.available ? "button" : undefined}
      tabIndex={seat.available ? 0 : undefined}
      onClick={() => seat.available && onSelect?.(seat.seatNumber)}
      onKeyDown={e => e.key === "Enter" && seat.available && onSelect?.(seat.seatNumber)}
      onMouseEnter={e => { if (c) (e.currentTarget as HTMLDivElement).style.background = c.hover; }}
      onMouseLeave={e => { if (c) (e.currentTarget as HTMLDivElement).style.background = c.bg; }}
      style={{
        width: 44,
        height: 40,
        borderRadius: 8,
        background: c ? c.bg : "#141414",
        border: `1px solid ${c ? c.border : "#252525"}`,
        cursor: seat.available ? "pointer" : "default",
        transition: "background 0.12s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
        WebkitUserSelect: "none",
        boxSizing: "border-box",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "ui-monospace, monospace",
        color: seat.available ? "#ffffff" : "#3a3a3a",
        lineHeight: 1,
        letterSpacing: "0.02em",
      }}
    >
      {seat.seatNumber}
    </div>
  );
}

export function SeatMap({ seats, flightId, onSelectSeat }: SeatMapProps) {
  const rows = Array.from(new Set(seats.map(s => s.row))).sort((a, b) => a - b);
  const available = seats.filter(s => s.available).length;

  function getSeat(row: number, col: string) {
    return seats.find(s => s.row === row && s.column === col);
  }

  const ROW_H = 40;
  const GAP = 4;
  const COL_W = 44;

  return (
    <div style={{ background: "#0c0c0c", border: "1px solid #1e1e1e", borderRadius: 16, padding: 20, display: "inline-block" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#666", textTransform: "uppercase" }}>
            Flight {flightId}
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "#444" }}>{available} seats available</p>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "#333" }}>tap to select</p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {/* Row numbers */}
        <div style={{ paddingTop: 24 + GAP }}>
          {rows.map(row => (
            <div key={row} style={{ height: ROW_H, marginBottom: GAP, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <span style={{ fontSize: 11, color: "#333", fontFamily: "monospace", width: 14, textAlign: "right", display: "block" }}>{row}</span>
            </div>
          ))}
        </div>

        {/* Left group: A B C */}
        <div>
          <div style={{ display: "flex", gap: GAP, marginBottom: GAP }}>
            {["A","B","C"].map(col => (
              <div key={col} style={{ width: COL_W, textAlign: "center", fontSize: 11, color: "#444", fontWeight: 600 }}>{col}</div>
            ))}
          </div>
          {rows.map(row => (
            <div key={row} style={{ display: "flex", gap: GAP, marginBottom: GAP }}>
              {["A","B","C"].map(col => {
                const s = getSeat(row, col);
                return s ? <Seat key={col} seat={s} onSelect={onSelectSeat} /> : <div key={col} style={{ width: COL_W, height: ROW_H }} />;
              })}
            </div>
          ))}
        </div>

        {/* Aisle divider */}
        <div style={{ paddingTop: 24 + GAP }}>
          {rows.map(row => (
            <div key={row} style={{ height: ROW_H, marginBottom: GAP, width: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 1, height: 24, background: "#1e1e1e" }} />
            </div>
          ))}
        </div>

        {/* Right group: D E F */}
        <div>
          <div style={{ display: "flex", gap: GAP, marginBottom: GAP }}>
            {["D","E","F"].map(col => (
              <div key={col} style={{ width: COL_W, textAlign: "center", fontSize: 11, color: "#444", fontWeight: 600 }}>{col}</div>
            ))}
          </div>
          {rows.map(row => (
            <div key={row} style={{ display: "flex", gap: GAP, marginBottom: GAP }}>
              {["D","E","F"].map(col => {
                const s = getSeat(row, col);
                return s ? <Seat key={col} seat={s} onSelect={onSelectSeat} /> : <div key={col} style={{ width: COL_W, height: ROW_H }} />;
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 12, borderTop: "1px solid #161616" }}>
        {(["window","aisle","middle"] as const).map(type => (
          <span key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: COLORS[type].bg, border: `1px solid ${COLORS[type].border}`, display: "inline-block" }} />
            <span style={{ fontSize: 10, color: "#555", textTransform: "capitalize" }}>{type}</span>
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: "#141414", border: "1px solid #252525", display: "inline-block" }} />
          <span style={{ fontSize: 10, color: "#555" }}>Taken</span>
        </span>
      </div>
    </div>
  );
}
