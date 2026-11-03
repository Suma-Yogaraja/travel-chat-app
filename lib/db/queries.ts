import { eq, and, asc, gt, isNull } from "drizzle-orm";
import { db } from "./index";
import { conversations, messages, bookings, guestOtps } from "./schema";
import { randomUUID } from "crypto";

// --- Conversations ---

export async function createConversation(userId: string, title: string) {
  const id = randomUUID();
  const [conv] = await db
    .insert(conversations)
    .values({ id, userId, title })
    .returning();
  return conv;
}

export async function getConversations(userId: string) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(asc(conversations.updatedAt));
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
    .where(eq(bookings.userId, userId))
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
  await db.insert(guestOtps).values({ id, bookingRef, otp, expiresAt });
}

export async function getValidOtp(bookingRef: string, otp: string) {
  const now = new Date();
  const [row] = await db
    .select()
    .from(guestOtps)
    .where(
      and(
        eq(guestOtps.bookingRef, bookingRef),
        eq(guestOtps.otp, otp),
        gt(guestOtps.expiresAt, now),
        isNull(guestOtps.usedAt)
      )
    );
  return row ?? null;
}

export async function markOtpUsed(id: string) {
  await db
    .update(guestOtps)
    .set({ usedAt: new Date() })
    .where(eq(guestOtps.id, id));
}
