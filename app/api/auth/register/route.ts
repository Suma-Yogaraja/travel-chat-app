import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { getUserByEmail, createUserWithPassword } from "@/lib/db/queries";

const schema = z.object({
  name:     z.string().min(1),
  email:    z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { name, email, password } = parsed.data;
  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await createUserWithPassword({ id: randomUUID(), name, email, passwordHash });

  return NextResponse.json({ ok: true }, { status: 201 });
}
