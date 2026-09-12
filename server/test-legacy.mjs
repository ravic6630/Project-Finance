// Legacy: nominee audit, the Money Map, and the inactivity switch.
// Run from server/ with the API up:  node --env-file-if-exists=.env test-legacy.mjs
//
// The switch is driven with an injected clock (runLegacyChecks({ at })), so the
// ninety-day sequence — quiet, warned, released, and reset by a sign-in — runs
// in seconds against the real database and the real rules.
import bcrypt from 'bcryptjs';
import { db, now } from './src/db.js';
import { runLegacyChecks, warnLeadDays } from './src/services/legacy.js';

const API = 'http://localhost:4000/api';
let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};

async function http(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text() };
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const DOMAIN = '@legacytest.sampada';
const PW = 'secret123';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const onDay = (n) => new Date(Date.now() + n * 86400000); // "n days from now" as the clock

async function cleanup() {
  const rows = await db.prepare(`SELECT id FROM users WHERE email LIKE '%${DOMAIN}'`).all();
  for (const { id } of rows) {
    for (const t of ['sessions', 'subscriptions', 'holdings', 'cash_accounts', 'assets', 'transactions', 'net_worth_snapshots']) {
      try {
        await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
      } catch {}
    }
    await db.prepare('DELETE FROM family_links WHERE inviter_id = ? OR invitee_id = ?').run(id, id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
}

async function makeUser(email, name) {
  const info = await db
    .prepare('INSERT INTO users (email, name, password_hash, base_currency, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(email, name, bcrypt.hashSync(PW, 10), 'INR', 'user', now());
  const id = Number(info.lastInsertRowid);
  const token = (await http('/auth/login', { method: 'POST', body: { email, password: PW } })).body.token;
  return { id, email, name, token };
}
const signIn = async (u) => (await http('/auth/login', { method: 'POST', body: { email: u.email, password: PW } })).body.token;
const readUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
// Pretend the owner last signed in `n` days ago (and has no fresher session).
const goQuiet = async (u, n) => {
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(daysAgo(n), u.id);
  await db.prepare('UPDATE sessions SET last_seen = ? WHERE user_id = ?').run(daysAgo(n), u.id);
};

console.log('— legacy —');
await cleanup();

const owner = await makeUser(`ravi${DOMAIN}`, 'Ravi Owner');
const spouse = await makeUser(`meera${DOMAIN}`, 'Meera Spouse');
const stranger = await makeUser(`nobody${DOMAIN}`, 'Some Stranger');
const ts = now();

// Link owner ↔ spouse (an accepted, active link — the consent the feature rests on).
await db.prepare("INSERT INTO family_links (inviter_id, invitee_email, invitee_id, status, created_at, accepted_at) VALUES (?,?,?,?,?,?)")
  .run(owner.id, spouse.email, spouse.id, 'active', ts, ts);

// Some money to map.
await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(owner.id, 'HDFC Savings', 'BANK', 250000, 'INR', ts, ts);
await db.prepare('INSERT INTO cash_accounts (user_id,name,type,balance,currency,interest_rate,maturity_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(owner.id, 'SBI FD', 'FD', 500000, 'INR', 7.1, '2027-03-31', ts, ts);
const h = await db.prepare('INSERT INTO holdings (user_id,kind,symbol,name,quantity,avg_cost,currency,manual_price,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(owner.id, 'IN_STOCK', 'TCS', 'Tata Consultancy Services', 40, 3200, 'INR', 3600, 'Imported from Zerodha', ts, ts);
await db.prepare('INSERT INTO assets (user_id,name,type,value,currency,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(owner.id, 'Flat in Vizag', 'PROPERTY', 6500000, 'INR', ts, ts);

/* ------------------------------- settings --------------------------------- */
const s0 = await http('/legacy/settings', { token: owner.token });
ok(s0.status === 200 && s0.body.enabled === false, 'settings: off by default', JSON.stringify(s0.body).slice(0, 100));
ok(s0.body.members?.some((m) => m.user_id === spouse.id), 'settings: linked members are offered as contacts');
ok(s0.body.inactive_days === 0, 'settings: just signed in => 0 inactive days', String(s0.body.inactive_days));

const put = (body, token = owner.token) => http('/legacy/settings', { method: 'PUT', token, body });
ok((await put({ enabled: true, contact_user_id: stranger.id, inactivity_days: 90 })).status === 400, 'settings: an unlinked account cannot be named');
ok((await put({ enabled: true, contact_user_id: owner.id, inactivity_days: 90 })).status === 400, 'settings: you cannot name yourself');
ok((await put({ enabled: true, contact_user_id: spouse.id, inactivity_days: 3 })).status === 400, 'settings: a 3-day threshold is refused');
ok((await put({ enabled: true, contact_user_id: spouse.id, inactivity_days: 5000 })).status === 400, 'settings: a 5000-day threshold is refused');
ok((await put({ enabled: true, inactivity_days: 90 })).status === 400, 'settings: enabling with no contact is refused');

const armed = await put({ enabled: true, contact_user_id: spouse.id, inactivity_days: 90, note: 'Meera — everything is listed here. The flat papers are in the steel cupboard.' });
ok(armed.status === 200 && armed.body.enabled && armed.body.contact?.user_id === spouse.id, 'settings: naming a linked member arms the switch', JSON.stringify(armed.body).slice(0, 120));
ok(armed.body.inactivity_days === 90 && armed.body.warn_lead_days === 7, 'settings: 90 days, warned 7 days before');
ok(warnLeadDays(14) === 4 && warnLeadDays(30) === 7 && warnLeadDays(730) === 7, 'lead time scales down for short thresholds (14d => 4d)');

// The contact can see they were named, from their own account.
const sp = await http('/legacy/settings', { token: spouse.token });
ok(sp.body.named_by?.some((o) => o.user_id === owner.id && o.released === false), 'contact: sees who named them, not yet released', JSON.stringify(sp.body.named_by));

/* ------------------------------ nominee audit ----------------------------- */
const a0 = await http('/legacy/nominees', { token: owner.token });
ok(a0.body.counts?.total === 4 && a0.body.counts.unknown === 4, 'audit: 4 items, all "not recorded" to begin with', JSON.stringify(a0.body.counts));
const holdingId = Number(h.lastInsertRowid);
const cashId = a0.body.items.find((i) => i.kind === 'cash' && i.name === 'HDFC Savings').id;
const assetId = a0.body.items.find((i) => i.kind === 'asset').id;
const nom = (body) => http('/legacy/nominees', { method: 'POST', token: owner.token, body });
const a1 = await nom({ kind: 'holding', id: holdingId, status: 'registered', name: 'Meera' });
ok(a1.status === 200 && a1.body.counts.registered === 1 && a1.body.counts.unknown === 3, 'audit: a registered nominee is counted', JSON.stringify(a1.body.counts));
const a2 = await nom({ kind: 'cash', id: cashId, status: 'none' });
ok(a2.body.counts.none === 1 && a2.body.counts.unknown === 2, 'audit: "no nominee" is a distinct, honest state', JSON.stringify(a2.body.counts));
ok(a2.body.items.find((i) => i.id === holdingId && i.kind === 'holding')?.nominee_name === 'Meera', 'audit: the nominee name is kept');
ok((await nom({ kind: 'holding', id: holdingId, status: 'someday' })).status === 400, 'audit: an invalid status is refused');
ok((await nom({ kind: 'rocket', id: 1, status: 'none' })).status === 400, 'audit: an unknown kind is refused');
ok((await nom({ kind: 'asset', id: assetId, status: 'none' })).status === 200, 'audit: assets carry nominees too');
// Ownership: the spouse cannot edit the owner's rows even though they are linked.
ok((await http('/legacy/nominees', { method: 'POST', token: spouse.token, body: { kind: 'holding', id: holdingId, status: 'none' } })).status === 404,
   'audit: a linked member cannot change the owner\'s nominees (404)');
ok((await nom({ kind: 'holding', id: holdingId, status: 'none' })).body.items.find((i) => i.id === holdingId).nominee_name === null,
   'audit: switching to "none" drops the stale name');

/* -------------------------------- the map --------------------------------- */
const mine = await http('/legacy/map', { token: owner.token });
ok(mine.status === 200 && mine.body.role === 'owner', 'map: the owner can always see their own', String(mine.status));
const m = mine.body.map;
ok(m?.cash?.length === 2 && m.holdings?.length === 1 && m.assets?.length === 1, 'map: lists every account, holding and asset', JSON.stringify({ c: m?.cash?.length, h: m?.holdings?.length, a: m?.assets?.length }));
ok(m.holdings[0].held_via === 'Zerodha', 'map: says where a holding is held (from the import label)', m.holdings[0].held_via);
ok(m.cash.find((c) => c.type === 'FD')?.maturity_date === '2027-03-31', 'map: FD maturity is carried');
ok(m.contact?.email === spouse.email && /steel cupboard/.test(m.note), 'map: names the contact and carries the owner\'s note');
ok(m.net_worth > 0 && m.totals.assets === 6500000, 'map: totals are priced', JSON.stringify(m.totals));

ok((await http('/legacy/map', { token: spouse.token })).body.role === 'owner', 'map: /map with no id is always your OWN map');
const early = await http(`/legacy/map/${owner.id}`, { token: spouse.token });
ok(early.status === 403 && /90 days/.test(early.body.error || ''), 'map: the named contact is told to wait until the switch fires (403)', `${early.status} ${early.body.error}`);
ok((await http(`/legacy/map/${owner.id}`, { token: stranger.token })).status === 404, 'map: anyone else gets a 404, not a 403 (no leak that a map exists)');
ok((await http(`/legacy/map/${owner.id}/print`, { token: stranger.token, raw: true })).status === 404, 'map: the print view is gated the same way');

const print = await http('/legacy/map/print', { token: owner.token, raw: true });
ok(print.status === 200 && /<!doctype html>/i.test(print.text) && /Money Map/.test(print.text), 'print: owner gets a full HTML document');
ok(/HDFC Savings/.test(print.text) && /Tata Consultancy/.test(print.text) && /Flat in Vizag/.test(print.text), 'print: every item is in it');
ok(/UDGAM/.test(print.text) && /succession certificate/i.test(print.text), 'print: tells the family how to claim');
ok(!/<script/i.test(print.text.replace(/onclick="window.print\(\)"/, '')), 'print: no scripts beyond the print button');
// The note is user text and lands in HTML — it must be escaped.
await put({ enabled: true, contact_user_id: spouse.id, inactivity_days: 90, note: '<img src=x onerror=alert(1)> cupboard' });
const printX = await http('/legacy/map/print', { token: owner.token, raw: true });
ok(!/<img src=x/.test(printX.text) && /&lt;img src=x/.test(printX.text), 'print: the owner\'s note is escaped, not rendered');

/* -------------------------------- the switch ------------------------------ */
// Re-arm cleanly (the note change above reset it) and walk the calendar.
await put({ enabled: true, contact_user_id: spouse.id, inactivity_days: 90 });
await goQuiet(owner, 0);
let r = await runLegacyChecks({ at: onDay(30) });
ok(r.checked === 1 && r.warned === 0 && r.released === 0, 'day 30: nothing happens', JSON.stringify(r));
r = await runLegacyChecks({ at: onDay(82) });
ok(r.warned === 0, 'day 82: still quiet (warning is 7 days before, at 83)', JSON.stringify(r));
r = await runLegacyChecks({ at: onDay(83) });
ok(r.warned === 1 && r.released === 0, 'day 83: the OWNER is warned, nothing released', JSON.stringify(r));
ok(!!(await readUser(owner.id)).legacy_warned_at, 'day 83: warning is recorded');
r = await runLegacyChecks({ at: onDay(84) });
ok(r.warned === 0, 'day 84: the warning is not sent twice', JSON.stringify(r));
r = await runLegacyChecks({ at: onDay(89) });
ok(r.released === 0, 'day 89: not yet', JSON.stringify(r));
ok((await http(`/legacy/map/${owner.id}`, { token: spouse.token })).status === 403, 'day 89: the contact still cannot see the map');
r = await runLegacyChecks({ at: onDay(90) });
ok(r.released === 1, 'day 90: released', JSON.stringify(r));
const opened = await http(`/legacy/map/${owner.id}`, { token: spouse.token });
ok(opened.status === 200 && opened.body.role === 'contact' && opened.body.map.owner.email === owner.email, 'day 90: the contact can now read the Money Map', String(opened.status));
ok((await http(`/legacy/map/${owner.id}/print`, { token: spouse.token, raw: true })).status === 200, 'day 90: and print it');
ok((await http(`/legacy/map/${owner.id}`, { token: stranger.token })).status === 404, 'day 90: a stranger still gets nothing');
r = await runLegacyChecks({ at: onDay(120) });
ok(r.released === 0 && r.warned === 0, 'day 120: nothing fires twice', JSON.stringify(r));
ok((await http('/legacy/settings', { token: spouse.token })).body.named_by[0].released === true, 'contact: their own page shows it as released');

/* --------------------------- proof of life resets ------------------------- */
await signIn(owner);
const after = await readUser(owner.id);
ok(after.legacy_warned_at == null && after.legacy_released_at == null, 'a sign-in clears both the warning and the release');
ok((await http(`/legacy/map/${owner.id}`, { token: spouse.token })).status === 403, 'and the map closes to the contact again');
ok((await http('/legacy/settings', { token: owner.token })).body.enabled === true, 'without disarming the switch itself');

/* ------------------------ a severed link never fires ---------------------- */
await goQuiet(owner, 0);
await db.prepare("UPDATE family_links SET status = 'revoked' WHERE inviter_id = ? AND invitee_id = ?").run(owner.id, spouse.id);
r = await runLegacyChecks({ at: onDay(400) });
ok(r.skipped_unlinked === 1 && r.released === 0 && r.warned === 0, 'a switch whose contact was unlinked is skipped, never fired', JSON.stringify(r));
ok((await http('/legacy/settings', { token: owner.token })).body.contact_unlinked === true, 'and the owner is told their contact is no longer linked');
ok((await http(`/legacy/map/${owner.id}`, { token: spouse.token })).status === 404, 'an unlinked ex-contact gets a 404');

/* ------------------ from empty dropdown to nameable contact --------------- */
// The situation the page must carry someone out of: "family" that is only a
// name-only profile, and no linked account at all.
const parent = await makeUser(`parent${DOMAIN}`, 'Parent P');
const kid = await makeUser(`kid${DOMAIN}`, 'Kid Q');
await db.prepare('INSERT INTO profiles (user_id, name, relation, created_at) VALUES (?,?,?,?)').run(parent.id, 'Amma', 'Mother', now());

const p0 = (await http('/legacy/settings', { token: parent.token })).body;
ok(p0.members.length === 0 && p0.profile_count === 1, 'journey: a name-only profile is counted but NOT nameable', JSON.stringify({ m: p0.members.length, p: p0.profile_count }));
ok(p0.pending_invites.length === 0 && p0.received_invites.length === 0, 'journey: nothing pending yet');
ok((await http('/legacy/settings', { method: 'PUT', token: parent.token, body: { enabled: true, contact_user_id: kid.id, inactivity_days: 90 } })).status === 400,
   'journey: an unlinked account still cannot be named directly');

const inv = await http('/family/invite', { method: 'POST', token: parent.token, body: { email: kid.email } });
ok(inv.status === 201 && inv.body.account_exists === true, 'journey: invite sent from the flow the page uses', JSON.stringify(inv.body));
const p1 = (await http('/legacy/settings', { token: parent.token })).body;
ok(p1.pending_invites.length === 1 && p1.pending_invites[0].email === kid.email, 'journey: the sender sees it pending', JSON.stringify(p1.pending_invites));
const k1 = (await http('/legacy/settings', { token: kid.token })).body;
ok(k1.received_invites.length === 1 && k1.received_invites[0].inviter_name === 'Parent P', 'journey: the invitee sees who invited them', JSON.stringify(k1.received_invites));

ok((await http(`/family/${k1.received_invites[0].id}/accept`, { method: 'POST', token: kid.token })).status === 200, 'journey: accepted from the page');
const p2 = (await http('/legacy/settings', { token: parent.token })).body;
ok(p2.members.some((m) => m.user_id === kid.id) && p2.pending_invites.length === 0, 'journey: accepting moves them from pending to nameable', JSON.stringify(p2.members));
ok((await http('/legacy/settings', { method: 'PUT', token: parent.token, body: { enabled: true, contact_user_id: kid.id, inactivity_days: 90 } })).status === 200,
   'journey: and naming them now works');
await db.prepare('DELETE FROM profiles WHERE user_id = ?').run(parent.id);

/* --------------------------------- auth ----------------------------------- */
ok((await http('/legacy/settings')).status === 401, 'no token => 401');
ok((await http('/legacy/map/print', { raw: true })).status === 401, 'print with no token => 401');

console.log(`\n${pass} passed, ${fail} failed`);
await cleanup();
process.exit(fail ? 1 : 0);
