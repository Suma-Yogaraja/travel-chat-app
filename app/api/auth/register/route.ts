import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes, createHash, randomUUID } from "crypto";
import { getUserByEmail, createUserWithPassword, saveEmailVerificationToken } from "@/lib/db/queries";
import { sendVerificationEmail } from "@/lib/email";
import { validatePassword } from "@/lib/password";
import { apiHandler } from "@/lib/api-handler";
import { logger } from "@/lib/logger";

const schema = z.object({
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  email:     z.string().email(),
  password:  z.string().superRefine((val, ctx) => {
    const err = validatePassword(val);
    if (err) ctx.addIssue({ code: "custom", message: err });
  }),
});

export const POST = apiHandler(async (req) => {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { firstName, lastName, email, password } = parsed.data;
  const name = `${firstName} ${lastName}`;

  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUserWithPassword({ id: randomUUID(), name, email, passwordHash });

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await saveEmailVerificationToken({ id: randomUUID(), userId: user.id, tokenHash, expiresAt });

  const verifyLink = `${process.env.NEXTAUTH_URL}/verify-email?token=${rawToken}`;
  sendVerificationEmail({ to: email, name, verifyLink }).catch(err =>
    logger.warn("register_verification_email_error", { error: logger.err(err) })
  );

  return NextResponse.json({ ok: true }, { status: 201 });
}, {
  rateLimit:    { maxRequests: 10, windowMs: 15 * 60 * 1000 }, // 10 per 15 min per IP
  maxBodyBytes: 2048,
});
