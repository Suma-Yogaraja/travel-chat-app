import { pgTable, text, timestamp, json, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id:            text("id").primaryKey(),
  name:          text("name"),
  email:         text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image:         text("image"),
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
  content:        json("content").notNull(),
  createdAt:      timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id:            text("id").primaryKey(),
  // No FK — guest bookings use "gs-<timestamp>" as userId, not a real users.id
  userId:        text("user_id").notNull(),
  bookingRef:    text("booking_ref").notNull().unique(), // BK-... auth, GS-... guest
  flightId:      text("flight_id").notNull(),
  passengerName: text("passenger_name").notNull(),
  seat:          text("seat").notNull(),
  email:         text("email"), // populated for guest bookings; auth users have email in users table
  status:        text("status").notNull().default("confirmed"),
  createdAt:     timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const guestOtps = pgTable("guest_otps", {
  id:         text("id").primaryKey(),
  bookingRef: text("booking_ref").notNull(),
  otp:        text("otp").notNull(),
  expiresAt:  timestamp("expires_at", { mode: "date" }).notNull(),
  usedAt:     timestamp("used_at", { mode: "date" }),
});
