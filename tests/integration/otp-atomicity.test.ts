/**
 * Integration test — OTP atomicity against real PostgreSQL
 *
 * Run with: TEST_DATABASE_URL=<neon-url> npx vitest run tests/integration/otp-atomicity.test.ts
 *
 * Uses TEST_DATABASE_URL (not DATABASE_URL) so tests never accidentally run
 * against a development or production database. The skip guard enforces this.
 *
 * The SQL pattern under test:
 *   UPDATE guest_otps SET used_at = now()
 *   WHERE email = $1 AND purpose = 'booking' AND otp_hash = $2
 *     AND used_at IS NULL AND expires_at > now()
 *   RETURNING *
 *
 * PostgreSQL serialises concurrent UPDATEs on the same row: exactly one wins
 * the lock and returns a row; the others see used_at already set and return
 * nothing. This test makes that guarantee visible and regression-proof.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)("OTP atomicity — concurrent booking verifications", () => {
  type Queries = typeof import("../../lib/db/queries");
  let saveBookingVerificationOtp: Queries["saveBookingVerificationOtp"];
  let verifyAndConsumeBookingOtp: Queries["verifyAndConsumeBookingOtp"];

  // Collected during tests; deleted in afterAll.
  const testEmails: string[] = [];

  beforeAll(async () => {
    // Point the DB module at the isolated test database before it loads.
    // The Neon HTTP client reads DATABASE_URL at module-init time, so this
    // must happen before any import of lib/db/*.
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
    const q = await import("../../lib/db/queries");
    saveBookingVerificationOtp = q.saveBookingVerificationOtp;
    verifyAndConsumeBookingOtp = q.verifyAndConsumeBookingOtp;
  });

  afterAll(async () => {
    if (!testEmails.length) return;
    // Best-effort cleanup — OTPs expire in 10 min anyway, but explicit
    // cleanup keeps the test database tidy.
    try {
      const { db } = await import("../../lib/db/index");
      const { guestOtps } = await import("../../lib/db/schema");
      const { inArray } = await import("drizzle-orm");
      await db.delete(guestOtps).where(inArray(guestOtps.email, testEmails));
    } catch {
      // Non-fatal: cleanup failure should not mask a passing test suite.
    }
  });

  function uniqueEmail() {
    // .invalid is a reserved TLD — will never be a real mailbox
    const email = `otp-test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.invalid`;
    testEmails.push(email);
    return email;
  }

  it("exactly one concurrent verify succeeds, the other gets null", async () => {
    const email = uniqueEmail();
    const otp = "987654";
    await saveBookingVerificationOtp(email, otp);

    const [r1, r2] = await Promise.all([
      verifyAndConsumeBookingOtp(email, otp),
      verifyAndConsumeBookingOtp(email, otp),
    ]);

    // Return type is the OTP row on success, null on failure.
    const successes = [r1, r2].filter(r => r !== null);
    const failures  = [r1, r2].filter(r => r === null);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The winning row must have usedAt stamped — proves the update ran.
    const winner = successes[0]!;
    expect(winner).toHaveProperty("usedAt");
    expect(winner.usedAt).toBeInstanceOf(Date);
    expect(winner.email).toBe(email);
  });

  it("three concurrent verifies: exactly one succeeds", async () => {
    const email = uniqueEmail();
    const otp = "111222";
    await saveBookingVerificationOtp(email, otp);

    const results = await Promise.all([
      verifyAndConsumeBookingOtp(email, otp),
      verifyAndConsumeBookingOtp(email, otp),
      verifyAndConsumeBookingOtp(email, otp),
    ]);

    expect(results.filter(r => r !== null)).toHaveLength(1);
    expect(results.filter(r => r === null)).toHaveLength(2);
  });

  it("sequential second call on a consumed OTP returns null (not a race, baseline verification)", async () => {
    const email = uniqueEmail();
    const otp = "333444";
    await saveBookingVerificationOtp(email, otp);

    const first  = await verifyAndConsumeBookingOtp(email, otp);
    const second = await verifyAndConsumeBookingOtp(email, otp);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("wrong OTP returns null and does not consume the valid one", async () => {
    const email = uniqueEmail();
    const otp = "555666";
    await saveBookingVerificationOtp(email, otp);

    const wrong  = await verifyAndConsumeBookingOtp(email, "000000");
    const correct = await verifyAndConsumeBookingOtp(email, otp);

    expect(wrong).toBeNull();
    expect(correct).not.toBeNull();
  });
});
