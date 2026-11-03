import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes, createHash } from "crypto";
import { randomUUID } from "crypto";
import { getUserByEmail, savePasswordResetToken } from "@/lib/db/queries";
import { sendPasswordResetEmail } from "@/lib/email";

const schema = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Always 200 — prevents email enumeration
    return NextResponse.json({ ok: true });
  }

  const { email } = parsed.data;
  const user = await getUserByEmail(email);

  if (user?.passwordHash) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await savePasswordResetToken({ id: randomUUID(), userId: user.id, tokenHash, expiresAt });

    const resetLink = `${process.env.NEXTAUTH_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail({ to: email, resetLink }).catch(err =>
      console.error("[forgot-password] email error:", err)
    );
  }

  // Always return 200 — caller shows "if that address is registered you'll receive a link"
  return NextResponse.json({ ok: true });
}
