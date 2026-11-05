// Structured logger — JSON lines in production (searchable in Vercel log explorer),
// human-readable with colour in development. Zero dependencies.

export type LogFields = Record<string, unknown>;
type Level = "info" | "warn" | "error";

/** Convert any caught value into a plain object safe to embed in log fields. */
export function serializeError(err: unknown): Record<string, string | undefined> {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? err.cause.message : undefined;
    return { name: err.name, message: err.message, stack: err.stack, cause };
  }
  return { message: String(err) };
}

function emit(level: Level, msg: string, fields?: LogFields): void {
  if (process.env.NODE_ENV === "production") {
    // info → stdout; warn/error → stderr so Vercel derives log level from stream.
    const stream = level === "info" ? process.stdout : process.stderr;
    stream.write(
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
