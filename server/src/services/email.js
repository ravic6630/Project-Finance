import nodemailer from 'nodemailer';

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT) || 587;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const SECURE = process.env.SMTP_SECURE === 'true' || PORT === 465;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

export const EMAIL_FROM = process.env.EMAIL_FROM || (USER ? `Sampada <${USER}>` : 'Sampada <no-reply@sampada.app>');

// Prefer Brevo's HTTP API: many hosts (e.g. Render's free tier) block outbound
// SMTP ports 25/465/587, which makes nodemailer time out. The HTTP API uses 443
// and works everywhere. SMTP stays as a fallback for hosts that allow it.
const useBrevo = !!BREVO_API_KEY;

export const emailConfigured = () => useBrevo || !!HOST;

// "Sampada <a@b.com>" -> { name: 'Sampada', email: 'a@b.com' }
function parseFrom(s) {
  const m = String(s || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || 'Sampada', email: m[2].trim() };
  return { name: 'Sampada', email: String(s || '').trim() };
}

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

async function sendViaBrevo({ to, subject, html, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseFrom(EMAIL_FROM),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(text ? { textContent: text } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

// Send an email. Throws a friendly error if no sender is configured.
export async function sendMail({ to, subject, html, text }) {
  if (!emailConfigured()) {
    throw new Error(
      "Email isn't set up yet. Add BREVO_API_KEY (recommended — works on hosts that block SMTP) or SMTP_HOST/USER/PASS."
    );
  }
  if (useBrevo) return sendViaBrevo({ to, subject, html, text });
  return getTransport().sendMail({ from: EMAIL_FROM, to, subject, html, text });
}
