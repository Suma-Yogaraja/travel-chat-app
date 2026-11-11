import { pgTable, text, timestamp, jsonb, integer, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id:            text("id").primaryKey(),
  name:          text("name"),
  email:         text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image:         text("image"),
  passwordHash:  text("password_hash"),
});

export const accounts = pgTable("accounts", {
  userId:            text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type:              text("type").notNull(),
  provider:          text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token:     text("refresh_token"),
  access_token:      text("access_token"),
  expires_at:        integer("expires_at"),
  token_type:        text("token_type"),
  scope:             text("scope"),
  id_token:          text("id_token"),
  session_state:     text("session_state"),
});

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires:      timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token:      text("token").notNull(),
  expires:    timestamp("expires", { mode: "date" }).notNull(),
});

export const conversations = pgTable("conversations", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title:     text("title").notNull().default("New conversation"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id:             text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role:           text("role").notNull(), // "user" | "assistant" | "tool"
  // JSONB: stores the full CoreMessage object (text + tool calls + tool results)
  // Plain text would lose tool call history and break conversation resumption
  content:        jsonb("content").notNull(),
  createdAt:      timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id:               text("id").primaryKey(),
  // No FK — guest bookings use "gs-<uuid>" as userId, not a real users.id
  userId:           text("user_id").notNull(),
  bookingRef:       text("booking_ref").notNull().unique(), // BK-... auth, GS-... guest
  flightId:         text("flight_id").notNull(),
  offerId:          uuid("offer_id"),                       // audit link to flight_offers; null for pre-migration rows
  passengerName:    text("passenger_name").notNull(),
  seat:             text("seat").notNull(),
  email:            text("email"), // populated for guest bookings; auth users have email in users table
  status:           text("status").notNull().default("confirmed"),
  // Stripe payment fields
  stripeSessionId:  text("stripe_session_id").unique(),
  paymentStatus:    text("payment_status").notNull().default("pending"), // "pending" | "paid" | "expired" | "failed"
  seatPriceMinor:   integer("seat_price_minor"),                         // seat surcharge paid in minor units (null = $0)
  expiresAt:        timestamp("expires_at", { mode: "date" }),
  createdAt:        timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
}, (t) => [
  // Prevents two confirmed bookings for the same seat on the same flight.
  // confirmBooking sets status = 'confirmed'; the second one will throw a unique violation.
  uniqueIndex("bookings_flight_seat_confirmed")
    .on(t.flightId, t.seat)
    .where(sql`${t.status} = 'confirmed'`),
]);

export const guestOtps = pgTable("guest_otps", {
  id:         text("id").primaryKey(),
  bookingRef: text("booking_ref"),           // null for booking OTPs (no ref yet)
  email:      text("email"),                 // null for seat_change OTPs (use bookingRef)
  purpose:    text("purpose").notNull().default("seat_change"), // "seat_change" | "booking"
  otp:        text("otp").notNull(),
  expiresAt:  timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt:     timestamp("used_at", { mode: "date" }),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt:    timestamp("used_at", { mode: "date" }),
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id:        text("id").primaryKey(),
  userId:    text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt:    timestamp("used_at", { mode: "date" }),
});

export const flightOffers = pgTable("flight_offers", {
  id:              uuid("id").primaryKey().defaultRandom(),
  provider:        text("provider").notNull(),              // "duffel" | "mock"
  providerOfferId: text("provider_offer_id"),               // Duffel offer ID, null for mock
  ownerUserId:     text("owner_user_id"),                   // null = unowned (guest)
  guestSessionId:  text("guest_session_id"),                // from HttpOnly cookie — enforced by validateOfferForCheckout
  origin:          text("origin").notNull(),
  destination:     text("destination").notNull(),
  departureAt:     timestamp("departure_at", { mode: "date", withTimezone: true }).notNull(),
  cabinClass:      text("cabin_class").notNull().default("economy"),
  segments:        jsonb("segments").notNull(),              // full flight data for display/audit
  priceMinor:      integer("price_minor").notNull(),         // e.g. 15999 for $159.99 USD
  currency:        text("currency").notNull().default("USD"),
  seatPrices:      jsonb("seat_prices"),                     // Record<seatNumber, priceMinor> — populated by get_flight_seats
  expiresAt:       timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  createdAt:       timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});
