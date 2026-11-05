// Structured logger — JSON lines to stdout in production (searchable in Vercel log explorer),
// human-readable with colour in development. Zero dependencies.

export type LogFields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

/** Convert any caught value into a plain object safe to embed in log fields. */
export function serializeError(err: unknown): Record<string, string> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}

function emit(level: Level, msg: string, fields?: LogFields): void {
  if (process.env.NODE_ENV === "production") {
    // One JSON line per event — Vercel captures stdout per-invocation.
    // Use process.stdout.write to avoid console's extra formatting.
    process.stdout.write(
      JSON.stringify({ level, ts: new Date().toISOString(), msg, ...fields }) + "\n"
    );
  } else {
    const c = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : "\x1b[36m";
    const r = "\x1b[0m";
    if (fields) {
      console[level](`${c}[${level.toUpperCase()}]${r} ${msg}`, fields);
    } else {
      console[level](`${c}[${level.toUpperCase()}]${r} ${msg}`);
    }
  }
}

export const logger = {
  info:  (msg: string, fields?: LogFields) => emit("info",  msg, fields),
  warn:  (msg: string, fields?: LogFields) => emit("warn",  msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
  /** Shorthand: include caught errors as structured fields. */
  err: serializeError,
};
