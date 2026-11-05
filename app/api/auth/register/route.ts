import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getUserByEmail, createUserWithPassword } from "@/lib/db/queries";
import { sendWelcomeEmail } from "@/lib/email";
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
  await createUserWithPassword({ id: randomUUID(), name, email, passwordHash });

  sendWelcomeEmail({ to: email, name }).catch(err =>
    logger.warn("register_welcome_email_error", { error: logger.err(err) })
  );

  return NextResponse.json({ ok: true }, { status: 201 });
});
