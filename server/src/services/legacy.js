import { db, now } from '../db.js';
import { escapeHtml, HttpError } from '../util.js';
import { emailConfigured, sendMail } from './email.js';
import { buildSummary } from './summary.js';
import { linkedMembers } from './family.js';
import { KIND_LABELS } from '../markets.js';
import { BROKER_LABELS } from './brokers.js';

/* Legacy — make sure your family finds everything.
 *
 * Around a lakh crore rupees sits unclaimed in India's financial system, much
 * of it because nobody left behind knew an account existed, or no nominee was
 * ever registered. This module is the answer Sampada can give, in three parts:
 *
 *   1. A nominee audit: every holding, account and asset carries whether a
 *      nominee is registered, so the gaps are visible while they can be fixed.
 *   2. A Money Map: one printable document listing everything the owner has,
 *      where it is held, and who the nominee is — what a family actually needs.
 *   3. A quiet switch: the owner names one linked family member. If the owner
 *      does not sign in for N days, the owner is warned first; if they still
 *      don't, the contact is shown the Money Map. Any sign-in resets it.
 *
 * What it deliberately is NOT: access to the account, the ability to change
 * anything, or a share of the owner's day-to-day dashboard. The contact sees
 * the map, read-only, and only after the switch has fired.
 */

const APP_URL = process.env.APP_URL || process.env.BROKER_REDIRECT_BASE || 'https://sampada-j9hi.onrender.com';
const NAVY = '#1f3a66';
const GOLD = '#a8884b';

export const MIN_INACTIVITY_DAYS = 14;
export const MAX_INACTIVITY_DAYS = 730;
export const NOMINEE_STATUSES = ['registered', 'none'];

const DAY = 86400000;
const days = (ms) => ms / DAY;

/* ------------------------------- settings --------------------------------- */

const userRow = db.prepare(
  `SELECT id, name, email, base_currency, created_at, last_login_at,
          legacy_enabled, legacy_contact_user_id, legacy_inactivity_days,
          legacy_warned_at, legacy_released_at, legacy_note
     FROM users WHERE id = ?`
);
const lastSeenRow = db.prepare('SELECT MAX(last_seen) AS last_seen FROM sessions WHERE user_id = ? AND revoked_at IS NULL');
const saveSettings = db.prepare(
  `UPDATE users SET legacy_enabled = ?, legacy_contact_user_id = ?, legacy_inactivity_days = ?,
                    legacy_note = ?, legacy_warned_at = NULL, legacy_released_at = NULL
    WHERE id = ?`
);
const setWarned = db.prepare('UPDATE users SET legacy_warned_at = ? WHERE id = ?');
const setReleased = db.prepare('UPDATE users SET legacy_released_at = ? WHERE id = ?');
const clearSwitch = db.prepare('UPDATE users SET legacy_warned_at = NULL, legacy_released_at = NULL WHERE id = ?');
// Every owner whose switch is armed. The contact join is re-checked at run
// time against family_links, so a severed link can never release anything.
const armedOwners = db.prepare(
  `SELECT id FROM users WHERE legacy_enabled = 1 AND legacy_contact_user_id IS NOT NULL`
);
// Owners who have named THIS user — what the contact's own page lists.
const namedBy = db.prepare(
  `SELECT id, name, email, legacy_inactivity_days, legacy_warned_at, legacy_released_at
     FROM users WHERE legacy_enabled = 1 AND legacy_contact_user_id = ?`
);
// The rest of the linking journey, so the page can carry someone from "the
// dropdown is empty" all the way to a nameable contact without leaving:
// invites I've sent that nobody has accepted yet, invites waiting on ME, and
// how many name-only profiles I have (they're the thing people mistake for
// linkable family — a profile has no login, so there is no one to email).
const sentInvites = db.prepare(
  `SELECT id, invitee_email AS email, created_at FROM family_links WHERE inviter_id = ? AND status = 'invited' ORDER BY created_at DESC`
);
const receivedInvites = db.prepare(
  `SELECT l.id, l.created_at, u.name AS inviter_name, u.email AS inviter_email
     FROM family_links l JOIN users u ON u.id = l.inviter_id
    WHERE l.status = 'invited' AND l.invitee_email = ? ORDER BY l.created_at DESC`
);
const profileCount = db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?');

// When was this account last used? The sign-in clock is rolled by every login;
// sessions carry a throttled heartbeat for people who stay signed in for weeks
// without ever seeing the login page. Either counts as "alive".
export async function lastActiveAt(userId) {
  const u = await userRow.get(userId);
  if (!u) return null;
  const sess = await lastSeenRow.get(userId);
  const candidates = [u.last_login_at, sess?.last_seen, u.created_at]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t));
  return candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
}

// The warning goes out this many days before the release. Short thresholds
// get a proportionally shorter lead so a 14-day switch doesn't warn on day 7.
export const warnLeadDays = (threshold) => Math.min(7, Math.max(1, Math.floor(threshold / 3)));

export async function legacySettings(userId, { at = new Date() } = {}) {
  const u = await userRow.get(userId);
  if (!u) throw new HttpError(404, 'Account not found');
  const members = await linkedMembers(userId);
  const contact = u.legacy_contact_user_id ? members.find((m) => m.id === Number(u.legacy_contact_user_id)) || null : null;
  const lastActive = await lastActiveAt(userId);
  const inactiveDays = lastActive ? Math.floor(days(at.getTime() - Date.parse(lastActive))) : null;
  const threshold = Number(u.legacy_inactivity_days) || 90;
  return {
    enabled: !!u.legacy_enabled,
    // A contact that is no longer linked is reported as such rather than
    // silently dropped — the owner needs to know the switch has no one to
    // fire for.
    contact: contact ? { user_id: contact.id, name: contact.name || contact.email, email: contact.email } : null,
    contact_unlinked: !!u.legacy_contact_user_id && !contact,
    inactivity_days: threshold,
    warn_lead_days: warnLeadDays(threshold),
    note: u.legacy_note || '',
    warned_at: u.legacy_warned_at || null,
    released_at: u.legacy_released_at || null,
    last_active_at: lastActive,
    inactive_days: inactiveDays,
    members: members.map((m) => ({ user_id: m.id, name: m.name || m.email, email: m.email })),
    pending_invites: await sentInvites.all(userId),
    received_invites: (await receivedInvites.all(String(u.email).toLowerCase())).map((r) => ({
      id: r.id,
      inviter_name: r.inviter_name || r.inviter_email,
      inviter_email: r.inviter_email,
      created_at: r.created_at,
    })),
    profile_count: Number((await profileCount.get(userId))?.n || 0),
    // Owners who have named ME, so the contact side of the feature is visible
    // from the same page.
    named_by: (await namedBy.all(userId)).map((o) => ({
      user_id: o.id,
      name: o.name || o.email,
      inactivity_days: o.legacy_inactivity_days,
      released: !!o.legacy_released_at,
    })),
  };
}

export async function updateLegacySettings(userId, { enabled, contact_user_id, inactivity_days, note }) {
  const u = await userRow.get(userId);
  if (!u) throw new HttpError(404, 'Account not found');
  const members = await linkedMembers(userId);

  const on = !!enabled;
  let contactId = null;
  if (on) {
    contactId = Number(contact_user_id);
    if (!Number.isInteger(contactId) || contactId <= 0) throw new HttpError(400, 'Choose who should be told');
    if (contactId === userId) throw new HttpError(400, "You can't name yourself");
    // Only a linked account can be named. The link is the consent: it was
    // accepted from their own login, so we know who they are and that they
    // agreed to be connected to this account at all.
    if (!members.some((m) => m.id === contactId)) {
      throw new HttpError(400, 'Your legacy contact must be a linked family member. Link them from the family menu first.');
    }
  }
  let threshold = Number(inactivity_days ?? u.legacy_inactivity_days ?? 90);
  if (!Number.isInteger(threshold) || threshold < MIN_INACTIVITY_DAYS || threshold > MAX_INACTIVITY_DAYS) {
    throw new HttpError(400, `Inactivity must be between ${MIN_INACTIVITY_DAYS} and ${MAX_INACTIVITY_DAYS} days`);
  }
  const cleanNote = note == null ? u.legacy_note : String(note).trim().slice(0, 2000) || null;

  const changedContact = on && contactId !== Number(u.legacy_contact_user_id);
  // Any change re-arms the switch from zero: a released map is closed, a
  // pending warning forgotten. Nothing decided under the old settings carries
  // over to the new ones.
  await saveSettings.run(on ? 1 : 0, contactId, threshold, cleanNote, userId);

  if (changedContact) {
    const contact = members.find((m) => m.id === contactId);
    await sendSafely({
      to: contact.email,
      subject: `${u.name || u.email} named you as their legacy contact on Sampada`,
      html: namedEmailHtml(u, contact, threshold),
    });
  }
  return legacySettings(userId);
}

export async function disarmForUser(userId) {
  await clearSwitch.run(userId);
}

/* ------------------------------- the switch ------------------------------- */
// Runs from the daily cron. `at` is injectable so the sequence can be tested
// without waiting ninety days.
export async function runLegacyChecks({ at = new Date() } = {}) {
  const owners = await armedOwners.all();
  const out = { checked: 0, warned: 0, released: 0, skipped_unlinked: 0 };
  for (const { id } of owners) {
    const u = await userRow.get(id);
    if (!u) continue;
    const members = await linkedMembers(id);
    const contact = members.find((m) => m.id === Number(u.legacy_contact_user_id));
    if (!contact) {
      // The link was severed after the contact was named. A switch with no
      // one on the other end must never fire; it waits until re-armed.
      out.skipped_unlinked += 1;
      continue;
    }
    out.checked += 1;
    const lastActive = await lastActiveAt(id);
    if (!lastActive) continue;
    const inactive = days(at.getTime() - Date.parse(lastActive));
    const threshold = Number(u.legacy_inactivity_days) || 90;
    const lead = warnLeadDays(threshold);

    if (inactive >= threshold - lead && !u.legacy_warned_at) {
      await setWarned.run(at.toISOString(), id);
      out.warned += 1;
      await sendSafely({
        to: u.email,
        subject: `Still there? Your Money Map opens to ${contact.name || contact.email} in ${Math.max(1, Math.ceil(threshold - inactive))} days`,
        html: warnEmailHtml(u, contact, inactive, threshold),
      });
    }
    if (inactive >= threshold && u.legacy_warned_at && !u.legacy_released_at) {
      await setReleased.run(at.toISOString(), id);
      out.released += 1;
      await sendSafely({
        to: contact.email,
        subject: `${u.name || u.email}'s Money Map is now open to you`,
        html: releasedContactEmailHtml(u, contact, threshold),
      });
      await sendSafely({
        to: u.email,
        subject: `Your Money Map has been shared with ${contact.name || contact.email}`,
        html: releasedOwnerEmailHtml(u, contact, threshold),
      });
    }
  }
  return out;
}

/* ----------------------------- nominee audit ------------------------------ */

const nomineeTargets = {
  holding: { table: 'holdings', label: 'Investments' },
  cash: { table: 'cash_accounts', label: 'Cash & Bank' },
  asset: { table: 'assets', label: 'Assets' },
};

export async function setNominee(userId, { kind, id, status, name }) {
  const t = nomineeTargets[kind];
  if (!t) throw new HttpError(400, 'kind must be holding, cash or asset');
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId <= 0) throw new HttpError(400, 'id is required');
  const st = status == null || status === '' ? null : String(status).toLowerCase();
  if (st != null && !NOMINEE_STATUSES.includes(st)) throw new HttpError(400, 'status must be registered, none, or blank');
  const nm = st === 'registered' ? String(name || '').trim().slice(0, 120) || null : null;
  const info = await db
    .prepare(`UPDATE ${t.table} SET nominee_status = ?, nominee_name = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(st, nm, now(), rowId, userId);
  if (!info.changes) throw new HttpError(404, 'Not found');
  return nomineeAudit(userId);
}

const statusOf = (r) => (r.nominee_status === 'registered' ? 'registered' : r.nominee_status === 'none' ? 'none' : 'unknown');

export async function nomineeAudit(userId) {
  const [holdings, cash, assets] = await Promise.all([
    db.prepare('SELECT id, kind, name, symbol, scheme_code, nominee_status, nominee_name FROM holdings WHERE user_id = ? ORDER BY kind, name').all(userId),
    db.prepare('SELECT id, name, type, nominee_status, nominee_name FROM cash_accounts WHERE user_id = ? ORDER BY type, name').all(userId),
    db.prepare('SELECT id, name, type, nominee_status, nominee_name FROM assets WHERE user_id = ? ORDER BY type, name').all(userId),
  ]);
  const item = (kind, r, sub) => ({
    kind,
    id: r.id,
    name: r.name,
    sub,
    status: statusOf(r),
    nominee_name: r.nominee_name || null,
  });
  const items = [
    ...holdings.map((r) => item('holding', r, KIND_LABELS[r.kind] || r.kind)),
    ...cash.map((r) => item('cash', r, r.type)),
    ...assets.map((r) => item('asset', r, r.type)),
  ];
  const counts = { total: items.length, registered: 0, none: 0, unknown: 0 };
  for (const i of items) counts[i.status] += 1;
  return { counts, items };
}

/* -------------------------------- the map --------------------------------- */
// Who may see whose map. The owner always may (it is their own). The named
// contact may once the switch has fired — and only while the link that made
// them nameable still stands. Everyone else gets a 404, not a 403: the fact
// that a map exists is itself the owner's to keep.
export async function assertMapAccess(viewerId, ownerId) {
  if (Number(viewerId) === Number(ownerId)) return { role: 'owner' };
  const owner = await userRow.get(ownerId);
  if (!owner || !owner.legacy_enabled || Number(owner.legacy_contact_user_id) !== Number(viewerId)) {
    throw new HttpError(404, 'Not found');
  }
  const stillLinked = (await linkedMembers(ownerId)).some((m) => m.id === Number(viewerId));
  if (!stillLinked) throw new HttpError(404, 'Not found');
  if (!owner.legacy_released_at) {
    throw new HttpError(403, `${owner.name || 'They'} have named you as their legacy contact, but their Money Map only opens if they stop signing in for ${owner.legacy_inactivity_days} days.`);
  }
  return { role: 'contact' };
}

export async function moneyMap(ownerId) {
  const u = await userRow.get(ownerId);
  if (!u) throw new HttpError(404, 'Account not found');
  const summary = await buildSummary(u, { scope: null, withItems: true, skipCashflow: true });
  const [cash, assets, brokers, contact] = await Promise.all([
    db.prepare('SELECT * FROM cash_accounts WHERE user_id = ? ORDER BY type, name').all(ownerId),
    db.prepare('SELECT * FROM assets WHERE user_id = ? ORDER BY type, name').all(ownerId),
    db.prepare('SELECT broker FROM broker_connections WHERE user_id = ?').all(ownerId),
    u.legacy_contact_user_id ? userRow.get(u.legacy_contact_user_id) : null,
  ]);

  const nominee = (r) => ({ status: statusOf(r), name: r.nominee_name || null });
  const source = (notes) => {
    const m = /^Imported from (.+)$/i.exec(String(notes || '').trim());
    return m ? m[1] : null;
  };

  const holdings = (summary.items || []).map((h) => ({
    id: h.id,
    kind: h.kind,
    kind_label: KIND_LABELS[h.kind] || h.kind,
    name: h.name,
    identifier: h.kind === 'IN_MF' ? (h.scheme_code ? `AMFI ${h.scheme_code}` : null) : h.symbol || null,
    quantity: h.quantity,
    currency: h.currency,
    value: h.market_value ?? null,
    value_base: h.market_value_base ?? null,
    held_via: source(h.notes),
    nominee: nominee(h),
    notes: source(h.notes) ? null : h.notes || null,
  }));

  return {
    generated_at: now(),
    owner: { id: u.id, name: u.name || u.email, email: u.email, base_currency: u.base_currency },
    contact: contact ? { name: contact.name || contact.email, email: contact.email } : null,
    note: u.legacy_note || null,
    net_worth: summary.net_worth,
    totals: {
      investments: summary.investments?.value ?? 0,
      cash: summary.cash?.total ?? 0,
      assets: summary.assets?.total ?? 0,
    },
    brokers: brokers.map((b) => BROKER_LABELS[b.broker] || b.broker),
    cash: cash.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
      interest_rate: a.interest_rate,
      maturity_date: a.maturity_date,
      nominee: nominee(a),
      notes: a.notes || null,
    })),
    holdings,
    assets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      value: a.value,
      nominee: nominee(a),
      notes: a.notes || null,
    })),
  };
}

/* ------------------------------ printable map ----------------------------- */
export function moneyMapHtml(map, { viewerRole = 'owner' } = {}) {
  const money = (v, cur) => {
    try {
      return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 2 }).format(v || 0);
    } catch {
      return `${cur} ${Number(v || 0).toFixed(2)}`;
    }
  };
  const e = escapeHtml;
  const nom = (n) =>
    n.status === 'registered'
      ? `<span style="color:#059669;font-weight:700">Registered${n.name ? ` · ${e(n.name)}` : ''}</span>`
      : n.status === 'none'
        ? `<span style="color:#b45309;font-weight:700">No nominee</span>`
        : `<span style="color:#94a3b8">Not recorded</span>`;
  const th = (t, right = false) => `<th style="text-align:${right ? 'right' : 'left'};padding:8px 10px;font-size:11px;letter-spacing:1px;color:#64748b;border-bottom:1px solid #e8e2d4">${t}</th>`;
  const td = (t, right = false, extra = '') => `<td style="padding:9px 10px;font-size:13px;vertical-align:top;border-bottom:1px solid #f1ede3;text-align:${right ? 'right' : 'left'};${extra}">${t}</td>`;
  const table = (heads, rows) =>
    rows.length
      ? `<table style="width:100%;border-collapse:collapse;margin-top:8px">${heads}${rows.join('')}</table>`
      : `<p style="font-size:13px;color:#94a3b8;margin:8px 0 0">Nothing recorded.</p>`;
  const section = (title, body) => `
    <h2 style="margin:26px 0 4px;font-size:12px;font-weight:800;letter-spacing:1.5px;color:${GOLD};text-transform:uppercase">${title}</h2>${body}`;

  const cashRows = map.cash.map((a) =>
    `<tr>${td(`<b>${e(a.name)}</b><div style="color:#64748b;font-size:12px">${e(a.type)}${a.maturity_date ? ` · matures ${e(a.maturity_date)}` : ''}${a.notes ? ` · ${e(a.notes)}` : ''}</div>`)}${td(nom(a.nominee))}${td(money(a.balance, a.currency), true)}</tr>`
  );
  const holdRows = map.holdings.map((h) =>
    `<tr>${td(`<b>${e(h.name)}</b><div style="color:#64748b;font-size:12px">${e(h.kind_label)}${h.identifier ? ` · ${e(h.identifier)}` : ''}${h.held_via ? ` · via ${e(h.held_via)}` : ''}${h.notes ? ` · ${e(h.notes)}` : ''}</div>`)}${td(nom(h.nominee))}${td(`${Number(h.quantity || 0).toLocaleString('en-IN')} units`, true)}${td(h.value != null ? money(h.value, h.currency) : '—', true)}</tr>`
  );
  const assetRows = map.assets.map((a) =>
    `<tr>${td(`<b>${e(a.name)}</b><div style="color:#64748b;font-size:12px">${e(a.type)}${a.notes ? ` · ${e(a.notes)}` : ''}</div>`)}${td(nom(a.nominee))}${td(money(a.value, a.currency), true)}</tr>`
  );

  const gaps = [...map.cash, ...map.holdings, ...map.assets].filter((x) => x.nominee.status !== 'registered').length;
  const base = map.owner.base_currency;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Money Map — ${e(map.owner.name)}</title>
  <style>
    body{margin:0;background:#f4f2ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a}
    .page{max-width:860px;margin:0 auto;padding:28px 20px 60px}
    .card{background:#fff;border:1px solid #e8e2d4;border-radius:14px;padding:18px 20px}
    @media print{.no-print{display:none}body{background:#fff!important}.card{border-color:#ddd}}
  </style></head><body><div class="page">
    <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="font-size:12px;color:#64748b">${viewerRole === 'contact' ? 'Shared with you as a legacy contact.' : 'Only you can see this until your legacy switch fires.'}</span>
      <button onclick="window.print()" style="background:${NAVY};color:#fff;border:0;border-radius:10px;padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer">Save as PDF / Print</button>
    </div>
    <div class="card">
      <div style="font-size:12px;letter-spacing:1.5px;color:${GOLD};font-weight:800">🌱 SAMPADA · MONEY MAP</div>
      <h1 style="margin:6px 0 2px;font-size:26px;color:${NAVY}">Everything ${e(map.owner.name)} owns, and where it is</h1>
      <div style="font-size:13px;color:#64748b">Prepared ${e(map.generated_at.slice(0, 10))} · figures in ${e(base)} at that date · ${e(map.owner.email)}</div>
      ${map.note ? `<div style="margin-top:14px;padding:12px 14px;background:#faf8f1;border:1px solid #efeadd;border-radius:10px;font-size:14px;line-height:1.5;white-space:pre-wrap">${e(map.note)}</div>` : ''}
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:16px">
        <div><div style="font-size:11px;color:#64748b">NET WORTH</div><div style="font-size:22px;font-weight:800;color:${NAVY}">${money(map.net_worth, base)}</div></div>
        <div><div style="font-size:11px;color:#64748b">INVESTMENTS</div><div style="font-size:16px;font-weight:700">${money(map.totals.investments, base)}</div></div>
        <div><div style="font-size:11px;color:#64748b">CASH &amp; BANK</div><div style="font-size:16px;font-weight:700">${money(map.totals.cash, base)}</div></div>
        <div><div style="font-size:11px;color:#64748b">ASSETS</div><div style="font-size:16px;font-weight:700">${money(map.totals.assets, base)}</div></div>
      </div>
      ${gaps ? `<div style="margin-top:14px;font-size:13px;color:#b45309"><b>${gaps}</b> item${gaps === 1 ? '' : 's'} below ${gaps === 1 ? 'has' : 'have'} no registered nominee recorded. Those are the ones that take longest to claim.</div>` : ''}
    </div>

    ${section('Cash & bank', table(`<tr>${th('Account')}${th('Nominee')}${th('Balance', true)}</tr>`, cashRows))}
    ${section('Investments', table(`<tr>${th('Holding')}${th('Nominee')}${th('Units', true)}${th('Value', true)}</tr>`, holdRows))}
    ${map.brokers.length ? `<p style="font-size:12px;color:#64748b;margin:8px 0 0">Broker accounts connected to Sampada: ${map.brokers.map(e).join(', ')}.</p>` : ''}
    ${section('Property & other assets', table(`<tr>${th('Asset')}${th('Nominee')}${th('Value', true)}</tr>`, assetRows))}

    ${section('How to claim these', `<div class="card" style="font-size:13px;line-height:1.6">
      <p style="margin:0 0 8px"><b>Where a nominee is registered:</b> the nominee approaches the bank, broker or fund house with the death certificate and their own KYC. The institution transfers to the nominee.</p>
      <p style="margin:0 0 8px"><b>Where there is no nominee:</b> legal heirs will need a succession certificate or probated will in addition. This is slower — which is why the gaps above matter now.</p>
      <p style="margin:0 0 8px"><b>Bank deposits untouched for 10 years</b> move to the RBI's DEA Fund; they can still be claimed through the bank, and the RBI's <b>UDGAM</b> portal (udgam.rbi.org.in) searches every participating bank by name.</p>
      <p style="margin:0"><b>Mutual funds and shares:</b> each fund house / depository handles transmission; unclaimed dividends and shares older than seven years sit with the <b>IEPF</b> and can be reclaimed from there.</p>
    </div>`)}
    <p style="margin-top:22px;font-size:11px;color:#94a3b8">Generated by Sampada from the owner's own records. Values are as of the date shown and will have changed; the point of this document is what exists and where, not what it is worth today.</p>
  </div></body></html>`;
}

/* --------------------------------- emails --------------------------------- */
async function sendSafely(msg) {
  if (!emailConfigured()) {
    console.warn(`[legacy] email not configured — would have sent "${msg.subject}" to ${msg.to}`);
    return false;
  }
  try {
    await sendMail(msg);
    return true;
  } catch (err) {
    console.error('[legacy] email failed:', err?.message);
    return false;
  }
}

const shell = (title, body) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="color:${NAVY};margin:0 0 6px">🌱 Sampada</h2>
  <h3 style="margin:0 0 12px;color:${NAVY}">${title}</h3>${body}
  <p style="color:#94a3b8;font-size:12px;margin-top:22px">Sampada · Wealth, all in one place</p></div>`;
const btn = (href, label) => `<p style="margin:18px 0"><a href="${href}" style="background:${NAVY};color:#fff;text-decoration:none;border-radius:10px;padding:11px 18px;font-weight:700;display:inline-block">${label}</a></p>`;
const first = (u) => escapeHtml((u.name || u.email).split(' ')[0]);

function namedEmailHtml(owner, contact, threshold) {
  return shell(
    `${first(owner)} has named you as their legacy contact`,
    `<p>Hi ${first(contact)}, <b>${escapeHtml(owner.name || owner.email)}</b> has set you as the person Sampada should turn to if they ever stop signing in.</p>
     <p>Nothing is shared now. If they go <b>${threshold} days</b> without signing in, Sampada will warn them first — and if they still don't, you'll receive a link to their <b>Money Map</b>: one page listing every account, holding and asset they have recorded, where it's held, and who the nominee is.</p>
     <p style="color:#64748b;font-size:13px">You can see this from your own Sampada account under Settings → Legacy. There's nothing you need to do.</p>`
  );
}

function warnEmailHtml(owner, contact, inactive, threshold) {
  const left = Math.max(1, Math.ceil(threshold - inactive));
  return shell(
    'Still there?',
    `<p>Hi ${first(owner)}, you haven't signed in to Sampada for <b>${Math.floor(inactive)} days</b>.</p>
     <p>You asked us to share your Money Map with <b>${escapeHtml(contact.name || contact.email)}</b> after ${threshold} days of silence. That's <b>${left} day${left === 1 ? '' : 's'}</b> from now.</p>
     <p>If everything's fine, just sign in — that resets the clock and nothing is shared.</p>
     ${btn(`${APP_URL}/login`, 'Sign in to Sampada')}
     <p style="color:#64748b;font-size:13px">If you'd rather change the contact or the waiting period, it's under Settings → Legacy.</p>`
  );
}

function releasedContactEmailHtml(owner, contact, threshold) {
  return shell(
    `${escapeHtml(owner.name || owner.email)}'s Money Map is now open to you`,
    `<p>Hi ${first(contact)}, <b>${escapeHtml(owner.name || owner.email)}</b> hasn't signed in to Sampada for ${threshold} days, and asked that you be shown their Money Map if that ever happened.</p>
     <p>It lists every account, holding and asset they recorded, where each is held, and who the nominee is — along with how to claim each kind.</p>
     ${btn(`${APP_URL}/legacy/view/${owner.id}`, 'Open the Money Map')}
     <p style="color:#64748b;font-size:13px">It's read-only, and it closes again the moment they sign in. If you know they're simply away, no action is needed.</p>`
  );
}

function releasedOwnerEmailHtml(owner, contact, threshold) {
  return shell(
    `Your Money Map has been shared with ${escapeHtml(contact.name || contact.email)}`,
    `<p>Hi ${first(owner)}, after ${threshold} days without a sign-in — and a warning ${warnLeadDays(threshold)} days ago — Sampada has opened your Money Map to <b>${escapeHtml(contact.name || contact.email)}</b>, as you asked.</p>
     <p>If this shouldn't have happened, signing in closes it again immediately.</p>
     ${btn(`${APP_URL}/login`, 'Sign in and close it')}`
  );
}
