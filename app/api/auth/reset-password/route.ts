import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { getValidPasswordResetToken, markPasswordResetTokenUsed, updateUserPassword } from "@/lib/db/queries";

const schema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = await getValidPasswordResetToken(tokenHash);

  if (!row) {
    return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await markPasswordResetTokenUsed(row.id);
  await updateUserPassword(row.userId, passwordHash);

  return NextResponse.json({ ok: true });
}
