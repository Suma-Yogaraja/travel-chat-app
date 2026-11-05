import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { consumeEmailVerificationToken, setEmailVerified } from "@/lib/db/queries";
import { apiHandler } from "@/lib/api-handler";

const schema = z.object({ token: z.string().min(1) });

export const POST = apiHandler(async (req) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const { token } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await consumeEmailVerificationToken(tokenHash);

  if (!row) {
    return NextResponse.json(
      { error: "This verification link is invalid or has already been used" },
      { status: 400 }
    );
  }

  await setEmailVerified(row.userId);
  return NextResponse.json({ ok: true });
}, {
  rateLimit:    { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  maxBodyBytes: 512,
});
