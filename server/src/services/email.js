import nodemailer from 'nodemailer';

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT) || 587;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const SECURE = process.env.SMTP_SECURE === 'true' || PORT === 465;
export const EMAIL_FROM = process.env.EMAIL_FROM || (USER ? `Sampada <${USER}>` : 'Sampada <no-reply@sampada.app>');

export const emailConfigured = () => !!HOST;

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: SECURE,
      ...(USER && PASS ? { auth: { user: USER, pass: PASS } } : {}),
    });
  }
  return transport;
}

// Send an email. Throws a friendly error if SMTP isn't configured.
export async function sendMail({ to, subject, html, text }) {
  if (!emailConfigured()) {
    throw new Error(
      "Email isn't set up yet. Add SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM to server/.env."
    );
  }
  return getTransport().sendMail({ from: EMAIL_FROM, to, subject, html, text });
}
