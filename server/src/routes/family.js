import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, escapeHtml } from '../util.js';
import { sendMail, emailConfigured } from '../services/email.js';
import { linkedMembers } from '../services/family.js';

export const familyRouter = Router();
familyRouter.use(authRequired);

const MAX_ACTIVE_LINKS = 8;
const MAX_PENDING_SENT = 8;
const APP_URL = process.env.APP_URL || process.env.BROKER_REDIRECT_BASE || 'https://sampada-j9hi.onrender.com';

const getLink = db.prepare('SELECT * FROM family_links WHERE id = ?');
const activePairStmt = db.prepare(`
  SELECT id FROM family_links WHERE status = 'active' AND (
    (inviter_id = ? AND invitee_id = ?) OR (inviter_id = ? AND invitee_id = ?)
  )
`);
const userByEmail = db.prepare('SELECT id, name, email FROM users WHERE email = ?');
const userById = db.prepare('SELECT id, name, email FROM users WHERE id = ?');

const myEmail = (req) => String(req.user.email || '').toLowerCase();

// Everything about my household: active members (either direction), invites
// I've sent that are still pending, and invites waiting on ME.
familyRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const actives = await db
      .prepare(`SELECT * FROM family_links WHERE status = 'active' AND (inviter_id = ? OR invitee_id = ?)`)
      .all(uid, uid);
    const members = [];
    for (const l of actives) {
      const partnerId = l.inviter_id === uid ? l.invitee_id : l.inviter_id;
      const u = await userById.get(partnerId);
      if (!u) continue;
      members.push({
        link_id: l.id,
        user_id: u.id,
        name: u.name || u.email,
        email: u.email,
        since: l.accepted_at,
        direction: l.inviter_id === uid ? 'sent' : 'received',
      });
    }
    const sentPending = await db
      .prepare(`SELECT id, invitee_email AS email, created_at FROM family_links WHERE inviter_id = ? AND status = 'invited'`)
      .all(uid);
    const receivedRows = await db
      .prepare(`SELECT * FROM family_links WHERE status = 'invited' AND invitee_email = ?`)
      .all(myEmail(req));
    const receivedPending = [];
    for (const l of receivedRows) {
      const from = await userById.get(l.inviter_id);
      if (!from) continue;
      receivedPending.push({
        id: l.id,
        inviter_name: from.name || from.email,
        inviter_email: from.email,
        created_at: l.created_at,
      });
    }
    res.json({ members, sent_pending: sentPending, received_pending: receivedPending });
  })
);

// Invite another Sampada account (or an email that hasn't signed up yet — the
// invite waits for them). Linking is mutual and view-only, so consent is
// explicit: nothing is shared until THEY accept from their own login.
familyRouter.post(
  '/invite',
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Please enter a valid email address');
    if (email === myEmail(req)) throw bad("That's your own email");

    const uid = req.user.id;
    const partner = await userByEmail.get(email);
    if (partner) {
      if (await activePairStmt.get(uid, partner.id, partner.id, uid)) {
        throw bad('You are already linked with that account');
      }
      const reverse = await db
        .prepare(`SELECT id FROM family_links WHERE status = 'invited' AND inviter_id = ? AND invitee_email = ?`)
        .get(partner.id, myEmail(req));
      if (reverse) throw bad('They already invited you — accept their invite in Manage family instead');
    }
    const dupe = await db
      .prepare(`SELECT id FROM family_links WHERE inviter_id = ? AND invitee_email = ? AND status IN ('invited','active')`)
      .get(uid, email);
    if (dupe) throw bad('You already invited that email');

    const pendingCount = Number(
      (await db.prepare(`SELECT COUNT(*) AS n FROM family_links WHERE inviter_id = ? AND status = 'invited'`).get(uid))?.n || 0
    );
    if (pendingCount >= MAX_PENDING_SENT) throw bad(`Up to ${MAX_PENDING_SENT} pending invites at a time`);
    if ((await linkedMembers(uid)).length >= MAX_ACTIVE_LINKS) {
      throw bad(`Up to ${MAX_ACTIVE_LINKS} linked accounts are supported`);
    }

    const info = await db
      .prepare('INSERT INTO family_links (inviter_id, invitee_email, status, created_at) VALUES (?, ?, ?, ?)')
      .run(uid, email, 'invited', now());

    if (emailConfigured()) {
      const inviter = escapeHtml(req.user.name || req.user.email);
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
        <h2 style="color:#1f3a66;margin:0 0 8px">🌱 Sampada</h2>
        <p style="color:#334155"><b>${inviter}</b> (${escapeHtml(req.user.email)}) invited you to share your family's net worth on Sampada.</p>
        <p style="color:#334155">Linking is mutual and <b>view-only</b>: you each keep your own login, and you both see the household total. You can unlink at any time.</p>
        <p>${
          partner
            ? `Sign in and open <b>Manage family</b> to accept.`
            : `Create a free account with this email address, then open <b>Manage family</b> to accept.`
        }</p>
        <a href="${APP_URL}" style="display:inline-block;background:#1f3a66;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Open Sampada →</a>
      </div>`;
      sendMail({ to: email, subject: `${req.user.name || 'Someone'} invited you to a Sampada family`, html }).catch((e) =>
        console.error('[family] invite email failed:', e.message)
      );
    }

    res.status(201).json({
      invite: { id: Number(info.lastInsertRowid), email, status: 'invited', created_at: now() },
      account_exists: !!partner,
    });
  })
);

// Accept an invite addressed to MY email. Atomic claim on status='invited'.
familyRouter.post(
  '/:id/accept',
  asyncHandler(async (req, res) => {
    const link = await getLink.get(req.params.id);
    if (!link || link.status !== 'invited' || link.invitee_email !== myEmail(req)) {
      throw new HttpError(404, 'Invite not found');
    }
    if (link.inviter_id === req.user.id) throw bad("You can't accept your own invite");
    const inviter = await userById.get(link.inviter_id);
    if (!inviter) {
      await db.prepare('DELETE FROM family_links WHERE id = ?').run(link.id);
      throw new HttpError(410, 'That invite is no longer valid');
    }
    if ((await linkedMembers(req.user.id)).length >= MAX_ACTIVE_LINKS) {
      throw bad(`Up to ${MAX_ACTIVE_LINKS} linked accounts are supported`);
    }
    // Mutual invites both accepted, or a stale duplicate: keep a single link.
    if (await activePairStmt.get(req.user.id, inviter.id, inviter.id, req.user.id)) {
      await db.prepare('DELETE FROM family_links WHERE id = ?').run(link.id);
      return res.json({ ok: true, already_linked: true });
    }
    const claimed = await db
      .prepare(`UPDATE family_links SET status = 'active', invitee_id = ?, accepted_at = ? WHERE id = ? AND status = 'invited'`)
      .run(req.user.id, now(), link.id);
    if (!claimed.changes) throw new HttpError(404, 'Invite not found');

    if (emailConfigured()) {
      const who = escapeHtml(req.user.name || req.user.email);
      sendMail({
        to: inviter.email,
        subject: `${req.user.name || 'Your invite'} joined your Sampada family 🎉`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
          <h2 style="color:#1f3a66;margin:0 0 8px">🌱 Sampada</h2>
          <p style="color:#334155"><b>${who}</b> accepted your family invite. Pick them from the household switcher to see the whole family together.</p>
        </div>`,
      }).catch((e) => console.error('[family] accept email failed:', e.message));
    }
    res.json({ ok: true, member: { user_id: inviter.id, name: inviter.name || inviter.email, email: inviter.email } });
  })
);

// Decline an invite addressed to me.
familyRouter.post(
  '/:id/decline',
  asyncHandler(async (req, res) => {
    const link = await getLink.get(req.params.id);
    if (!link || link.status !== 'invited' || link.invitee_email !== myEmail(req)) {
      throw new HttpError(404, 'Invite not found');
    }
    await db.prepare('DELETE FROM family_links WHERE id = ?').run(link.id);
    res.json({ ok: true });
  })
);

// Cancel my pending invite, or sever an active link from either side.
// Deleting the row cuts both directions of visibility immediately.
familyRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const link = await getLink.get(req.params.id);
    const mine =
      link &&
      (link.inviter_id === req.user.id || (link.status === 'active' && link.invitee_id === req.user.id));
    if (!mine) throw new HttpError(404, 'Link not found');
    await db.prepare('DELETE FROM family_links WHERE id = ?').run(link.id);
    res.json({ ok: true });
  })
);
