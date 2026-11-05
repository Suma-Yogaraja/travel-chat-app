import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { consumePasswordResetToken, updateUserPassword } from "@/lib/db/queries";
import { apiHandler } from "@/lib/api-handler";

const schema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8),
});

export const POST = apiHandler(async (req) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Atomic: marks the token used in the same query that validates it, preventing TOCTOU replay
  const row = await consumePasswordResetToken(tokenHash);

  if (!row) {
    return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await updateUserPassword(row.userId, passwordHash);

  return NextResponse.json({ ok: true });
}, {
  rateLimit:    { maxRequests: 10, windowMs: 15 * 60 * 1000 }, // 10 per 15 min per IP
  maxBodyBytes: 1024,
});
