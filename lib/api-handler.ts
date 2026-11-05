import { NextResponse } from "next/server";
import { logger } from "./logger";
import { checkRateLimit } from "./rate-limit";

export class AppError extends Error {
  constructor(public readonly message: string, public readonly status: number) {
    super(message);
    this.name = "AppError";
  }
}

type HandlerOptions = {
  /** Sliding-window rate limit applied before the handler runs. Key is scoped to pathname + IP. */
  rateLimit?: { maxRequests: number; windowMs: number };
  /** Reject requests whose Content-Length exceeds this value (bytes). */
  maxBodyBytes?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: Request, ctx?: any) => Promise<Response>;

export function apiHandler(handler: RouteHandler, opts?: HandlerOptions): RouteHandler {
  return async (req, ctx) => {
    if (opts?.maxBodyBytes) {
      const len = req.headers.get("content-length");
      if (len && parseInt(len, 10) > opts.maxBodyBytes) {
        return new Response("Payload too large", { status: 413 });
      }
    }

    if (opts?.rateLimit) {
      const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
      const { pathname } = new URL(req.url);
      if (!checkRateLimit(`${pathname}:${ip}`, opts.rateLimit).allowed) {
        return new Response("Too many requests", { status: 429 });
      }
    }

    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      const { pathname } = new URL(req.url);
      logger.error("api_unhandled_error", { method: req.method, path: pathname, error: logger.err(err) });
      return new Response("Internal server error", { status: 500 });
    }
  };
}
