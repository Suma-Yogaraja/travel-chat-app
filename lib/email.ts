import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Update to match your verified Resend domain once you have one.
// "onboarding@resend.dev" works for sending to your own account email only.
const FROM = process.env.EMAIL_FROM ?? "TravelChat <onboarding@resend.dev>";

interface BookingConfirmationParams {
  to: string;
  passengerName: string;
  bookingRef: string;
  flightId: string;
  seat: string;
}

interface SeatChangeParams {
  to: string;
  passengerName: string;
  bookingRef: string;
  flightId: string;
  oldSeat: string;
  newSeat: string;
}

interface CancellationParams {
  to: string;
  passengerName: string;
  bookingRef: string;
  flightId: string;
  seat: string;
}

interface OtpParams {
  to: string;
  bookingRef: string;
  otp: string;
}

export async function sendBookingConfirmation(params: BookingConfirmationParams) {
  const { to, passengerName, bookingRef, flightId, seat } = params;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Booking confirmed — ${bookingRef}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin: 0 0 8px;">✈️ Your booking is confirmed</h2>
        <p style="color: #6b7280; margin: 0 0 24px;">Here are your flight details.</p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Passenger</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${passengerName}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Flight</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${flightId}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Seat</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${seat}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Booking ref</td><td style="padding: 6px 0; font-weight: 600; text-align: right; font-family: monospace;">${bookingRef}</td></tr>
          </table>
        </div>
        <p style="color: #9ca3af; font-size: 12px;">This is a mock booking for a learning project. No real flight has been booked.</p>
      </div>
    `,
  });
}

export async function sendSeatChangeConfirmation(params: SeatChangeParams) {
  const { to, passengerName, bookingRef, flightId, oldSeat, newSeat } = params;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Seat updated — ${bookingRef}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin: 0 0 8px;">💺 Your seat has been updated</h2>
        <p style="color: #6b7280; margin: 0 0 24px;">Your seat selection has changed.</p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Passenger</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${passengerName}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Flight</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${flightId}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Old seat</td><td style="padding: 6px 0; color: #9ca3af; text-align: right; text-decoration: line-through;">${oldSeat}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">New seat</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${newSeat}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Booking ref</td><td style="padding: 6px 0; font-weight: 600; text-align: right; font-family: monospace;">${bookingRef}</td></tr>
          </table>
        </div>
        <p style="color: #9ca3af; font-size: 12px;">This is a mock booking for a learning project. No real flight has been booked.</p>
      </div>
    `,
  });
}

export async function sendCancellationConfirmation(params: CancellationParams) {
  const { to, passengerName, bookingRef, flightId, seat } = params;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Booking cancelled — ${bookingRef}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin: 0 0 8px;">❌ Your booking has been cancelled</h2>
        <p style="color: #6b7280; margin: 0 0 24px;">The following booking has been cancelled.</p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Passenger</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${passengerName}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Flight</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${flightId}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Seat</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${seat}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Booking ref</td><td style="padding: 6px 0; font-weight: 600; text-align: right; font-family: monospace;">${bookingRef}</td></tr>
          </table>
        </div>
        <p style="color: #9ca3af; font-size: 12px;">This is a mock booking for a learning project. No real flight has been booked.</p>
      </div>
    `,
  });
}

export async function sendOtpEmail(params: OtpParams) {
  const { to, bookingRef, otp } = params;
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Your TravelChat verification code — ${otp}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="margin: 0 0 8px;">🔐 Your verification code</h2>
        <p style="color: #6b7280; margin: 0 0 24px;">Use this code to verify your identity for booking ${bookingRef}.</p>
        <div style="background: #f9fafb; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #9ca3af; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}
