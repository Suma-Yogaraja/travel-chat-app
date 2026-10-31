import { eq, and, asc } from "drizzle-orm";
import { db } from "./index";
import { conversations, messages, bookings } from "./schema";
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
  // Security: verify the conversation belongs to this user before returning messages
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
  // Full CoreMessage object stored as JSONB — preserves tool calls and results
  content: unknown
) {
  const id = randomUUID();
  const [msg] = await db
    .insert(messages)
    .values({ id, conversationId, role, content })
    .returning();

  // Touch updatedAt on the conversation so sidebar ordering stays fresh
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
