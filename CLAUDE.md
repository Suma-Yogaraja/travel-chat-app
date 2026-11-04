# Travel Chat App

## What this is
A chat-based travel app where users search flights, book tickets, and change seats through conversation with Claude. Built to learn MCP servers, tool calling, streaming, hooks, and AI SDK patterns.

## Architecture
- **MCP server** (`mcp-server/`) exposes 5 travel tools. The app connects via `InMemoryTransport` (see `lib/mcp-bridge.ts`) — no subprocess, no stdio. `mcp-server/main()` is still exported for standalone use with Claude Desktop.
- **Tool split**: `search_flights` + `get_flight_seats` come from the MCP server via `lib/mcp-bridge.ts`. Session-aware tools are in `lib/tools.ts` — `create_checkout` (both auth and guest), `get_booking`, `change_seat` (auth), OTP tools (`send_booking_otp`, `get_guest_booking`, `request_otp`, `verify_and_cancel`, `verify_and_change_seat`) (guests only).
- **Flight data** comes from `lib/flight-provider/` — always use `getProvider()`, never import mock-provider directly.
- **Skills** in `skills/` are `.md` files loaded once at module level (not per-request) and composed into the system prompt.
- **Dual mode**: Guest (`/chat/guest`) = in-memory React state, no DB. Authenticated (`/chat/[id]`) = Postgres-persisted.
- **Auth** via NextAuth v5 — GitHub OAuth, Google OAuth, Email/Password (Credentials). Session available via `auth()` in server components and API routes.
- **Email** via Nodemailer + Gmail. Requires `GMAIL_USER` and `GMAIL_APP_PASSWORD` in `.env.local`.
- **Payments** via Stripe Checkout (hosted page). Both auth users and guests go through Stripe; guests must verify email via OTP before `create_checkout` is called.

## Conventions
- All MCP tool inputs must use Zod schemas.
- Every DB query on conversations/messages/bookings must filter by `session.user.id` — never return data without a userId check.
- Messages stored as JSONB (full UIMessage object), not plain text — preserves tool call history for conversation resumption.
- Guest bookings use a `gs-<uuid-prefix>` userId (not a real users.id row) and store email in `bookings.email`.
- OTP verification is required before any guest booking mutation (seat change, cancel). Auth users are already verified by session.
- Switch mock ↔ real flight API via `FLIGHT_PROVIDER` env var only. Zero code changes needed.
- Skills are loaded at module level in `app/api/chat/route.ts` — do not move them inside the request handler.
- `createTravelTools` takes a `TravelToolsContext` options object — never positional args. The `paymentProvider` field defaults to `stripePaymentProvider`; tests inject a fake. Never add more positional parameters.
- `guestSessionId` always comes from the server-set HttpOnly cookie (`lib/guest-session.ts`) — never from tool arguments. The model cannot supply or influence it.
- Offer pricing is server-authoritative: the model passes `offerId` (UUID), `validateOfferForCheckout` re-validates with Duffel and returns the current price. Never accept a price from tool arguments.

## Key files
- `mcp-server/index.ts` — 5 MCP tools, exports `createTravelMcpServer()` and `main()`. `get_flight_seats` falls back to a generated seat map if provider returns 0 seats.
- `lib/mcp-bridge.ts` — connects MCP server in-memory, returns AI SDK-compatible tools. `McpContext = { userId?, guestSessionId? }` — binds offers to identity.
- `lib/tools.ts` — session-aware direct tools: `create_checkout` (auth + guest), OTP tools (guest), `get_booking`, `change_seat`. Exports `TravelToolsContext` type and `createTravelTools(ctx)`.
- `lib/payment-provider.ts` — `PaymentProvider` interface + `CheckoutParams` type. Inject fakes in tests.
- `lib/stripe-payment-provider.ts` — Stripe implementation of `PaymentProvider`; only does the Stripe SDK call, no business logic.
- `lib/stripe.ts` — Stripe client singleton, circuit breaker (3 failures → 60s open), live key guard
- `lib/guest-session.ts` — `getOrCreateGuestSession(req)` reads/creates HttpOnly `guest-session-id` cookie (24h). Used to enforce offer ownership without login.
- `lib/chat-history.ts` — `searchFlightsPlaceholder(output)` extracts `F1=<uuid>` offer ID mapping for the context trimmer. If this drops IDs, the booking flow silently breaks.
- `lib/offers/offer-service.ts` — `validateOfferForCheckout(offerId, context)` enforces ownership + expiry + Duffel re-validation. `persistFlightOffer()` saves offers on search. Fail-closed: returns `provider_unavailable` if Duffel is unreachable.
- `lib/offers/offer-repository.ts` — DB queries for `flight_offers` table.
- `lib/offers/price-confirmation.ts` — HMAC-SHA256 `priceChangeToken` generation/verification. Used when Duffel reports a price change between search and checkout.
- `lib/booking-status.ts` — `getBookingPaymentStatus(booking)` pure mapping function.
- `lib/rate-limit.ts` — sliding-window rate limiter (20 req/min per IP, in-memory per process)
- `lib/flight-provider/index.ts` — FlightProvider interface + factory
- `lib/db/schema.ts` — Drizzle table definitions (includes `flight_offers` table)
- `lib/db/queries.ts` — all typed DB helpers. `verifyAndConsumeBookingOtp` uses atomic `UPDATE ... WHERE usedAt IS NULL RETURNING *`.
- `lib/auth.ts` — NextAuth config
- `lib/email.ts` — Nodemailer email functions (booking confirm, seat change, cancel, OTP). All templates include simulated-booking disclaimer.
- `app/api/chat/route.ts` — main AI streaming route
- `app/api/stripe/webhook/route.ts` — verifies Stripe signature, confirms/expires bookings. Expiry path reads booking first; skips if not pending; lets DB errors propagate (Stripe retries on non-200).
- `app/api/stripe/status/route.ts` — polling endpoint for success page
- `app/booking/success/page.tsx` — polls every 2s until payment confirmed. Shows simulated-booking disclaimer on success.
- `components/chat/pay-button.tsx` — Pay button card rendered in chat on `create_checkout` output
- `lib/langfuse-processor.ts` — singleton LangfuseSpanProcessor shared by instrumentation + chat route
- `instrumentation.ts` — registers OTel pipeline + AI SDK telemetry integration on startup
- `skills/` — Claude's travel assistant behaviour rules

## Test suite
Three-layer structure — 130 unit/contract tests + integration:
- **Layer 1** (`tests/layer1-tool-logic/`): Pure logic, no DB or network. `searchFlightsPlaceholder`, `getBookingPaymentStatus`, email disclaimer content, currency minor-unit conversion, price-change token generation/verification.
- **Layer 2** (`tests/layer2-mcp-contract/`): Contract tests with mocked DB/external services. Offer ownership enforcement (5 guest session scenarios), tool schemas (UUID-only `offerId`, no `priceUsd`), webhook handler (idempotency, state machine, duplicate events, error propagation), create_checkout (14 scenarios: auth/guest happy paths, offer errors, price-change flow, provider errors — key assertion: provider receives server-derived `priceMinor`).
- **Layer 3** (`tests/layer3-llm/`): Real Claude Haiku via AI SDK. Skip without `RUN_LLM_TESTS=1` and `ANTHROPIC_API_KEY` — costs real credits. Tests that model selects the right tool and passes `offerId` not `priceUsd`.
- **Integration** (`tests/integration/otp-atomicity.test.ts`): Real PostgreSQL OTP concurrency. Skip without `TEST_DATABASE_URL` (never use `DATABASE_URL` — that would hit dev/prod). Proves exactly one of N concurrent `verifyAndConsumeBookingOtp` calls succeeds.

Run unit+contract: `npx vitest run tests/layer1-tool-logic tests/layer2-mcp-contract`
Run integration: `TEST_DATABASE_URL=<neon-url> npx vitest run tests/integration`
Run LLM tests: `RUN_LLM_TESTS=1 npx vitest run tests/layer3-llm`

## Model
Currently using **Claude Haiku** (`claude-haiku-4-5-20251001`) via `@ai-sdk/anthropic`. Follows skill instructions reliably and supports prompt caching. To switch to Groq (free tier): swap import to `@ai-sdk/groq` and model to `groq("llama-3.3-70b-versatile")` — avoid `openai/gpt-oss-120b` which has an 8000 TPM limit too small for seat map + flight results.

## Cost optimisations in place
- Tool result trimming: old seat map / flight search results replaced with one-line placeholders
- Role-based tool filtering: guests get 6 tools (OTP + booking flow), auth users get 3 (MCP) + 3 (direct: `create_checkout`, `get_booking`, `change_seat`)
- History cap: last 30 model messages only
- Output cap: `maxOutputTokens: 600`, `stopWhen: stepCountIs(4)`

## Auth providers
- GitHub OAuth callback URL for production: `https://travel-chat-app-wine.vercel.app/api/auth/callback/github` — update in GitHub Developer settings if the deployment URL changes
- Google OAuth callback URL for production: `https://travel-chat-app-wine.vercel.app/api/auth/callback/google` — update in Google Cloud Console if URL changes
- GitHub OAuth, Google OAuth, Email/Password (Credentials) — all configured in `lib/auth.ts`
- Registration: `POST /api/auth/register` → bcrypt hash → `createUserWithPassword`
- Forgot password: `POST /api/auth/forgot-password` → token stored as SHA-256 hash in `password_reset_tokens`, email sent via Nodemailer
- Reset password: `POST /api/auth/reset-password` → verify token hash → `updateUserPassword`
- Password min 8 chars, bcrypt cost 12

## Environment variables
- Never edit `.env.local` via Claude Code — the security hook blocks writes to protect secrets. Use VS Code or any system text editor directly.
- Vercel env vars: add via Vercel dashboard or `vercel env add`. Sensitive keys (API secrets) should be `production` + `preview` only — never commit them.

## Security model
- Passwords: bcrypt (cost 12) — never stored in plaintext
- Password reset tokens: stored as SHA-256 hashes in `password_reset_tokens`, expire after 1 hour, single-use
- OTPs: stored as SHA-256 hashes in `guest_otps`, expire after 10 minutes, single-use
- Session strategy: JWT (required for Credentials provider to coexist with DrizzleAdapter)
- All DB queries on conversations/messages/bookings filter by `session.user.id`
- **Offer ownership**: auth-user offers require `ownerUserId === userId`. Guest offers require matching `guestSessionId` from the HttpOnly cookie. UUID alone is not authorization. Both branches return `not_found` on mismatch to prevent offer-existence enumeration.
- **Pricing**: model never supplies a price. `create_checkout` accepts `offerId` only; `validateOfferForCheckout` reads the authoritative price from DB and re-validates with Duffel. Fail-closed: if Duffel is unreachable, checkout is refused.
- **Price-change token**: if Duffel returns a different price, the backend issues an HMAC-SHA256-signed `priceChangeToken` bound to `{ offerId, priceMinor, currency, userId, exp }`. The model returns it unchanged to confirm the user accepted the new price. Never accept `acceptedPriceMinor` from the model.
- **Live Stripe keys**: `lib/stripe.ts` throws if `sk_live_` key is used outside `NODE_ENV=production`.
- **Simulated booking**: Stripe payment succeeds → DB confirmed + email sent. No real Duffel order is created. Disclaimer shown in success page and all email templates.

## Guest email verification
- Before a guest booking, Claude calls `send_booking_otp` with the email → OTP sent, stored hashed in `guest_otps` with `purpose = "booking"`
- Guest confirms code in chat → `create_checkout` called with `passengerEmail` + `otp` → verified atomically via `verifyAndConsumeBookingOtp`, then Stripe session created with GS- booking ref
- Existing seat-change/cancel OTP flow unchanged (`purpose = "seat_change"`, keyed by bookingRef)

## Flight date validation
- `search_flights` MCP tool rejects past dates before calling the provider — returns `{ error: "..." }` if date < today
- Mock provider ignores date (matches only on origin/destination) — date guard lives at MCP layer
- Claude also instructed in `skills/flight-search.md` to refuse past dates before calling the tool

## Error handling

### Global API handler (`lib/api-handler.ts`)
All API routes are wrapped with `apiHandler()` — a higher-order function that catches any unhandled error and returns a consistent response:
- `AppError` (thrown intentionally with message + status) → `{ error: message }` JSON with that status
- Anything else → `console.error("[API error] METHOD /path", err)` + 500
- `app/api/auth/forgot-password/route.ts` keeps an inner try/catch to preserve its always-200 contract (prevents email enumeration); the outer `apiHandler` is a safety net on top

### UI error boundaries
- `app/global-error.tsx` — React error boundary; catches any render crash across the whole app, shows "Something went wrong / Try again" instead of a blank screen
- `app/chat/[id]/page.tsx` and `app/chat/guest/page.tsx` — `status === "error"` banner shown at bottom of chat
- `components/bookings/booking-actions.tsx` — cancel errors shown inline; `setLoading(false)` called on failure so the button never stays disabled
- `app/chat/bookings/page.tsx` — DB error shows "Unable to load bookings. Please try again later."

### Auth page error states
All auth pages (`login`, `register`, `forgot-password`, `reset-password`) have `catch` blocks that surface network/server failures as inline error messages — loading state always resets on failure.

### saveMessage in onFinish
`saveMessage` in `onFinish` uses `.catch()` so a DB hiccup never kills the streaming response.

## Observability (Langfuse)

LLM traces are captured via `@langfuse/vercel-ai-sdk` + `@langfuse/otel` (Langfuse v5 SDK stack).

**Setup:**
- `instrumentation.ts`: `registerOTel({ spanProcessors: [langfuseProcessor] })` + `registerTelemetry(new LangfuseVercelAiSdkIntegration())`
- `lib/langfuse-processor.ts`: singleton `LangfuseSpanProcessor({ exportMode: "immediate" })` — shared between instrumentation and the chat route
- `app/api/chat/route.ts`: `telemetry: { isEnabled: true, functionId: "travel-chat", integrations: [langfuseIntegration] }` on `streamText`; `langfuseProcessor.forceFlush()` in `onFinish`
- Requires `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASEURL` env vars (also reads `LANGFUSE_BASE_URL`)

**Why this stack (not `langfuse-vercel` v3):**
Langfuse's server now only accepts spans via their OTel HTTP endpoint (`/api/public/otel/v1/traces`). The old `langfuse-vercel` v3 SDK sent via a proprietary format that was rejected with HTTP 400. AI SDK v7 also replaced `experimental_telemetry`'s OTel global approach with a callback integration system — `registerTelemetry()` is now the correct hook point.

**What Langfuse captures per conversation:**
- Full model input + output with tool calls and results
- Token usage, latency, and cost per trace
- Span hierarchy: `invoke_agent` → `chat` → per-step spans

## Flight provider

Active: **Duffel** (`FLIGHT_PROVIDER=duffel`) via `lib/flight-provider/duffel-provider.ts`.
Default fallback: **Mock** (`FLIGHT_PROVIDER=mock`) — hardcoded US routes, always works.
Archived: `amadeus-provider.ts` — Amadeus shut down their free dev portal July 2025, kept for reference.

**Duffel sandbox notes:**
- Free account at duffel.com, test token starts with `duffel_test_...`
- Seatmaps only available for Duffel Airways test flights and American Airlines test data — BA, Iberia, multi-stop flights return 0 seats in sandbox (works in production)
- When provider returns 0 seats, `mcp-server/index.ts` generates a deterministic fallback layout (20 rows × 6 cols, ~70% available, seeded from flightId)
- If seatmap cache is cold (server restart), `getFlightSeats` auto re-searches using params encoded in the flight ID (`DF-{ORIGIN}-{DESTINATION}-{DATE}-{INDEX}`)
- `bookFlight`, `getBooking`, `changeSeat` on the provider throw intentionally — handled by `lib/tools.ts` → Postgres

## Stripe payment

Both auth users and guests go through Stripe Checkout (hosted page). Guests must verify email via OTP first; auth users book directly with their session.

**Flow:**
1. Claude calls `create_checkout` → creates pending booking in DB + Stripe session → returns checkout URL
2. Chat renders `PayButton` component (detected from `create_checkout` tool output)
3. User clicks → Stripe hosted checkout → test card `4242 4242 4242 4242`
4. Stripe fires `checkout.session.completed` webhook → `app/api/stripe/webhook/route.ts` confirms booking in DB and sends confirmation email
5. Stripe redirects to `/booking/success?session_id=xxx` → page polls `/api/stripe/status` every 2s until `paymentStatus = 'paid'`

**Webhook is the source of truth** — never trust the browser redirect to confirm payment.

**DB fields added to `bookings`:** `stripe_session_id TEXT UNIQUE`, `payment_status TEXT DEFAULT 'paid'`, `expires_at TIMESTAMP`

**Env vars required:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

**Local testing:** `stripe listen --forward-to localhost:3002/api/stripe/webhook` (needs Stripe CLI — install binary directly from GitHub if brew fails due to Xcode version)
