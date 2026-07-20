import { Router } from 'express';
import { db, now } from '../db.js';
import { ADMIN_EMAILS } from '../config.js';
import { authRequired, requireAdmin } from '../auth.js';
import { asyncHandler, bad, escapeHtml, HttpError, str } from '../util.js';
import { emailConfigured, sendMail } from '../services/email.js';

export const supportRouter = Router();
supportRouter.use(authRequired);

const MAX_LEN = 4000;
const APP_URL = process.env.APP_URL || process.env.BROKER_REDIRECT_BASE || 'https://sampada-j9hi.onrender.com';

const insertMsg = db.prepare(
  'INSERT INTO support_messages (user_id, sender, body, created_at) VALUES (?, ?, ?, ?)'
);
const threadFor = db.prepare(
  'SELECT id, sender, body, created_at, read_at FROM support_messages WHERE user_id = ? ORDER BY id'
);
const markRead = db.prepare(
  'UPDATE support_messages SET read_at = ? WHERE user_id = ? AND sender = ? AND read_at IS NULL'
);
const countUnread = db.prepare(
  'SELECT COUNT(*) AS n FROM support_messages WHERE user_id = ? AND sender = ? AND read_at IS NULL'
);
const getUser = db.prepare('SELECT id, email, name FROM users WHERE id = ?');

const unreadFrom = async (userId, sender) => Number((await countUnread.get(userId, sender))?.n || 0);

function readBody(req) {
  const body = str(req.body?.body);
  if (!body) throw bad('Message cannot be empty');
  if (body.length > MAX_LEN) throw bad(`Message is too long (max ${MAX_LEN} characters)`);
  return body;
}

// Fire-and-forget notification — support must never fail because email is down.
async function notify({ to, subject, html }) {
  if (!emailConfigured() || !to) return;
  try {
    await sendMail({ to, subject, html });
  } catch (e) {
    console.error('[support] notification failed:', e.message);
  }
}

const shell = (title, who, body, cta) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:#1f3a66;margin:0 0 10px">🌱 Sampada</h2>
  <p style="margin:0 0 10px;font-weight:700;color:#1f3a66">${title}</p>
  <p style="margin:0 0 6px;color:#64748b;font-size:13px">${who}</p>
  <blockquote style="margin:0 0 18px;padding:12px 14px;background:#f4f2ec;border-left:3px solid #c2a368;border-radius:8px;color:#334155;white-space:pre-wrap">${body}</blockquote>
  <a href="${APP_URL}" style="display:inline-block;background:#1f3a66;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:12px">${cta}</a>
</div>`;

/* ---------------------------------- customer --------------------------------- */

// My conversation. Opening it marks the admin's replies as read.
supportRouter.get(
  '/thread',
  asyncHandler(async (req, res) => {
    const messages = await threadFor.all(req.user.id);
    await markRead.run(now(), req.user.id, 'admin');
    res.json({ messages, unread: 0 });
  })
);

// Cheap poll for the chat bubble's badge.
supportRouter.get(
  '/unread',
  asyncHandler(async (req, res) => {
    res.json({ unread: await unreadFrom(req.user.id, 'admin') });
  })
);

supportRouter.post(
  '/thread',
  asyncHandler(async (req, res) => {
    const body = readBody(req);
    // Only email the admin for the FIRST unanswered message, so a burst of
    // messages doesn't turn into a burst of emails.
    const alreadyWaiting = await unreadFrom(req.user.id, 'user');
    await insertMsg.run(req.user.id, 'user', body, now());
    const messages = await threadFor.all(req.user.id);
    res.json({ messages, unread: 0 });

    if (!alreadyWaiting) {
      const from = `${req.user.name || 'A customer'} (${req.user.email})`;
      for (const admin of ADMIN_EMAILS) {
        await notify({
          to: admin,
          subject: `New support message from ${req.user.name || req.user.email}`,
          html: shell('New support message', escapeHtml(from), escapeHtml(body), 'Reply in Sampada →'),
        });
      }
    }
  })
);

/* ----------------------------------- admin ----------------------------------- */

const listThreads = db.prepare(`
  SELECT u.id, u.email, u.name,
    (SELECT body       FROM support_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_body,
    (SELECT sender     FROM support_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
    (SELECT created_at FROM support_messages m WHERE m.user_id = u.id ORDER BY m.id DESC LIMIT 1) AS last_at,
    (SELECT COUNT(*)   FROM support_messages m WHERE m.user_id = u.id AND m.sender = 'user' AND m.read_at IS NULL) AS unread
  FROM users u
  WHERE EXISTS (SELECT 1 FROM support_messages m WHERE m.user_id = u.id)
  ORDER BY last_at DESC
`);

supportRouter.get(
  '/admin/threads',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await listThreads.all();
    const threads = rows.map((t) => ({ ...t, unread: Number(t.unread) }));
    res.json({ threads, unread_total: threads.reduce((s, t) => s + t.unread, 0) });
  })
);

// Open one customer's conversation; marks their messages as read.
supportRouter.get(
  '/admin/threads/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.userId);
    const user = await getUser.get(id);
    if (!user) throw new HttpError(404, 'User not found');
    const messages = await threadFor.all(id);
    await markRead.run(now(), id, 'user');
    res.json({ user, messages });
  })
);

supportRouter.post(
  '/admin/threads/:userId',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.userId);
    const user = await getUser.get(id);
    if (!user) throw new HttpError(404, 'User not found');
    const body = readBody(req);
    const alreadyWaiting = await unreadFrom(id, 'admin');
    await insertMsg.run(id, 'admin', body, now());
    const messages = await threadFor.all(id);
    res.json({ user, messages });

    // Let the customer know we replied (they may not have the app open).
    if (!alreadyWaiting) {
      await notify({
        to: user.email,
        subject: 'Sampada support replied to your message',
        html: shell(
          'We replied to your message',
          'From the Sampada team',
          escapeHtml(body),
          'Open the chat →'
        ),
      });
    }
  })
);
