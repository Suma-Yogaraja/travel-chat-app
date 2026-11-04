import { NextResponse } from "next/server";

export class AppError extends Error {
  constructor(public readonly message: string, public readonly status: number) {
    super(message);
    this.name = "AppError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler = (req: Request, ctx?: any) => Promise<Response>;

export function apiHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      const { pathname } = new URL(req.url);
      console.error(`[API error] ${req.method} ${pathname}`, err);
      return new Response("Internal server error", { status: 500 });
    }
  };
}
