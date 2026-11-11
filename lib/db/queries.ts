import { eq, and, asc, desc, gt, isNull, ne } from "drizzle-orm";
import { db } from "./index";
import { conversations, messages, bookings, guestOtps, users, passwordResetTokens, emailVerificationTokens } from "./schema";
import { randomUUID, createHash } from "crypto";

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

// --- Conversations ---

export async function createConversation(userId: string, title: string) {
  const id = randomUUID();
  const [conv] = await db
    .insert(conversations)
    .values({ id, userId, title })
    .returning();
  return conv;
}

export async function getConversations(userId: string, limit = 50) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

export async function getConversation(id: string, userId: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  return conv ?? null;
}

export async function updateConversationTitle(id: string, title: string) {
  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, id));
}

export async function deleteConversation(id: string, userId: string) {
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
}

// --- Messages ---

export async function getMessages(conversationId: string, userId: string) {
  const conv = await getConversation(conversationId, userId);
  if (!conv) throw new Error("Unauthorized");

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

export async function saveMessage(
  conversationId: string,
  role: string,
  content: unknown
) {
  const id = randomUUID();
  const [msg] = await db
    .insert(messages)
    .values({ id, conversationId, role, content })
    .returning();

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  return msg;
}

// --- Bookings ---

export async function saveBooking(params: {
  userId: string;
  bookingRef: string;
  flightId: string;
  passengerName: string;
  seat: string;
  email?: string;
}) {
  const id = randomUUID();
  const [booking] = await db
    .insert(bookings)
    .values({ id, ...params })
    .returning();
  return booking;
}

export async function getBookings(userId: string) {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.userId, userId), ne(bookings.paymentStatus, "pending")))
    .orderBy(asc(bookings.createdAt));
}

// Auth users: userId check enforced
export async function getBookingByRef(bookingRef: string, userId: string) {
  const [row] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.bookingRef, bookingRef), eq(bookings.userId, userId)));
  return row ?? null;
}

export async function cancelBooking(bookingRef: string, userId: string) {
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.bookingRef, bookingRef), eq(bookings.userId, userId)));
}

export async function updateBookingSeat(bookingRef: string, userId: string, newSeat: string) {
  const [row] = await db
    .update(bookings)
    .set({ seat: newSeat })
    .where(and(eq(bookings.bookingRef, bookingRef), eq(bookings.userId, userId)))
    .returning();
  return row ?? null;
}

// Guest bookings: no userId check — caller must have verified OTP first
export async function getBookingByRefOnly(bookingRef: string) {
  const [row] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.bookingRef, bookingRef));
  return row ?? null;
}

export async function cancelBookingByRef(bookingRef: string) {
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(eq(bookings.bookingRef, bookingRef));
}

export async function updateBookingSeatByRef(bookingRef: string, newSeat: string) {
  const [row] = await db
    .update(bookings)
    .set({ seat: newSeat })
    .where(eq(bookings.bookingRef, bookingRef))
    .returning();
  return row ?? null;
}

// --- Guest OTPs ---

export async function saveGuestOtp(bookingRef: string, otp: string) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  await db.insert(guestOtps).values({ id, bookingRef, otp: hashOtp(otp), expiresAt });
}

export async function saveBookingVerificationOtp(email: string, otp: string) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(guestOtps).values({ id, email, purpose: "booking", otp: hashOtp(otp), expiresAt });
}

// Atomic verify + consume for seat-change/cancel OTPs (keyed by bookingRef).
// Single UPDATE avoids the race condition of a separate SELECT then UPDATE.
export async function verifyAndConsumeOtp(bookingRef: string, otp: string) {
  const now = new Date();
  const [row] = await db
    .update(guestOtps)
    .set({ usedAt: now })
    .where(and(
      eq(guestOtps.bookingRef, bookingRef),
      eq(guestOtps.otp, hashOtp(otp)),
      gt(guestOtps.expiresAt, now),
      isNull(guestOtps.usedAt)
    ))
    .returning();
  return row ?? null;
}

// Atomic verify + consume for booking OTPs (keyed by email).
export async function verifyAndConsumeBookingOtp(email: string, otp: string) {
  const now = new Date();
  const [row] = await db
    .update(guestOtps)
    .set({ usedAt: now })
    .where(and(
      eq(guestOtps.email, email),
      eq(guestOtps.purpose, "booking"),
      eq(guestOtps.otp, hashOtp(otp)),
      gt(guestOtps.expiresAt, now),
      isNull(guestOtps.usedAt)
    ))
    .returning();
  return row ?? null;
}

// --- Users (email/password auth) ---

export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return user ?? null;
}

export async function createUserWithPassword(params: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}) {
  const [user] = await db
    .insert(users)
    .values({ ...params, email: params.email.toLowerCase() })
    .returning();
  return user;
}

export async function updateUserPassword(userId: string, passwordHash: string) {
  await db
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, userId));
}

// --- Password reset tokens ---

export async function savePasswordResetToken(params: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  await db.insert(passwordResetTokens).values(params);
}

export async function getValidPasswordResetToken(tokenHash: string) {
  const now = new Date();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, now),
        isNull(passwordResetTokens.usedAt)
      )
    );
  return row ?? null;
}

export async function markPasswordResetTokenUsed(id: string) {
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
}

// Atomic alternative to getValidPasswordResetToken + markPasswordResetTokenUsed.
// Prevents the TOCTOU race where two concurrent requests both pass the validity check.
export async function consumePasswordResetToken(tokenHash: string) {
  const now = new Date();
  const [row] = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(
      eq(passwordResetTokens.tokenHash, tokenHash),
      gt(passwordResetTokens.expiresAt, now),
      isNull(passwordResetTokens.usedAt),
    ))
    .returning();
  return row ?? null;
}

// --- Stripe payment ---

export async function createPendingBooking(params: {
  userId: string;
  bookingRef: string;
  flightId: string;
  passengerName: string;
  seat: string;
  email?: string;
  offerId?: string;
  stripeSessionId?: string;
  seatPriceMinor?: number;
  expiresAt: Date;
}) {
  const id = randomUUID();
  const [booking] = await db
    .insert(bookings)
    .values({ id, ...params, paymentStatus: "pending" })
    .returning();
  return booking;
}

// Called after Stripe session is created to link it to the pending booking.
export async function setBookingStripeSession(bookingRef: string, stripeSessionId: string) {
  await db
    .update(bookings)
    .set({ stripeSessionId })
    .where(and(eq(bookings.bookingRef, bookingRef), isNull(bookings.stripeSessionId)));
}

export async function updateBookingSeatAndPrice(bookingRef: string, userId: string, newSeat: string, seatPriceMinor: number) {
  const [row] = await db
    .update(bookings)
    .set({ seat: newSeat, seatPriceMinor })
    .where(and(eq(bookings.bookingRef, bookingRef), eq(bookings.userId, userId)))
    .returning();
  return row ?? null;
}

export async function updateBookingSeatAndPriceByRef(bookingRef: string, newSeat: string, seatPriceMinor: number) {
  const [row] = await db
    .update(bookings)
    .set({ seat: newSeat, seatPriceMinor })
    .where(eq(bookings.bookingRef, bookingRef))
    .returning();
  return row ?? null;
}

// Called by webhook when a seat upgrade payment completes.
export async function confirmSeatUpgrade(bookingRef: string, newSeat: string, newSeatPriceMinor: number): Promise<boolean> {
  const [row] = await db
    .update(bookings)
    .set({ seat: newSeat, seatPriceMinor: newSeatPriceMinor })
    .where(eq(bookings.bookingRef, bookingRef))
    .returning({ id: bookings.id });
  return !!row;
}

// Cleans up an orphaned pending booking if Stripe session creation fails.
export async function deletePendingBooking(bookingRef: string) {
  await db
    .delete(bookings)
    .where(and(
      eq(bookings.bookingRef, bookingRef),
      eq(bookings.paymentStatus, "pending"),
      isNull(bookings.stripeSessionId),
    ));
}

// Returns true if this call actually performed the pending→paid transition,
// false if the row was already confirmed or not found (concurrent delivery).
// Callers must check the return value before sending confirmation email.
export async function confirmBooking(stripeSessionId: string): Promise<boolean> {
  const [row] = await db
    .update(bookings)
    .set({ paymentStatus: "paid", status: "confirmed", expiresAt: null })
    .where(and(
      eq(bookings.stripeSessionId, stripeSessionId),
      eq(bookings.paymentStatus, "pending"),
    ))
    .returning({ id: bookings.id });
  return !!row;
}

export async function expireBooking(stripeSessionId: string) {
  // Only transition pending → expired. A confirmed booking cannot be expired retroactively.
  await db
    .update(bookings)
    .set({ paymentStatus: "expired", status: "cancelled" })
    .where(and(
      eq(bookings.stripeSessionId, stripeSessionId),
      eq(bookings.paymentStatus, "pending"),
    ));
}

export async function getBookingByStripeSession(stripeSessionId: string) {
  const [row] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripeSessionId, stripeSessionId));
  return row ?? null;
}

// --- Email verification ---

export async function saveEmailVerificationToken(params: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  await db.insert(emailVerificationTokens).values(params);
}

export async function consumeEmailVerificationToken(tokenHash: string) {
  const now = new Date();
  const [row] = await db
    .update(emailVerificationTokens)
    .set({ usedAt: now })
    .where(and(
      eq(emailVerificationTokens.tokenHash, tokenHash),
      gt(emailVerificationTokens.expiresAt, now),
      isNull(emailVerificationTokens.usedAt),
    ))
    .returning();
  return row ?? null;
}

export async function setEmailVerified(userId: string) {
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.id, userId));
}
