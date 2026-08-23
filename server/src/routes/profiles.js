import { Router } from 'express';
import { db, now } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler, bad, HttpError, str } from '../util.js';

export const profilesRouter = Router();
profilesRouter.use(authRequired);

const list = db.prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY id');
const getOne = db.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?');
const insert = db.prepare('INSERT INTO profiles (user_id, name, relation, created_at) VALUES (?, ?, ?, ?)');
const update = db.prepare('UPDATE profiles SET name = ?, relation = ? WHERE id = ? AND user_id = ?');
const remove = db.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?');
const MAX_PROFILES = 15;

// Counts let the manage UI say "3 holdings · 1 account" per member. One grouped
// query per table instead of three per profile — the old shape was 3N round
// trips to Turso, which is remote in production.
const countsByProfile = (table) =>
  db.prepare(
    `SELECT profile_id, COUNT(*) AS n FROM ${table} WHERE user_id = ? AND profile_id IS NOT NULL GROUP BY profile_id`
  );
const countHoldings = countsByProfile('holdings');
const countAccounts = countsByProfile('cash_accounts');
const countAssets = countsByProfile('assets');
const toMap = (rows) => new Map(rows.map((r) => [Number(r.profile_id), Number(r.n)]));

profilesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows, hRows, cRows, aRows] = await Promise.all([
      list.all(req.user.id),
      countHoldings.all(req.user.id),
      countAccounts.all(req.user.id),
      countAssets.all(req.user.id),
    ]);
    const h = toMap(hRows);
    const c = toMap(cRows);
    const a = toMap(aRows);
    // A member with nothing yet produces no group row — default those to 0.
    res.json({
      profiles: rows.map((p) => ({
        ...p,
        counts: { holdings: h.get(p.id) || 0, accounts: c.get(p.id) || 0, assets: a.get(p.id) || 0 },
      })),
    });
  })
);

profilesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = str(req.body.name);
    if (!name) throw bad('A name is required');
    const existing = await list.all(req.user.id);
    if (existing.length >= MAX_PROFILES) throw bad(`Up to ${MAX_PROFILES} family members are supported`);
    const info = await insert.run(req.user.id, name, str(req.body.relation), now());
    res.status(201).json({ profile: await getOne.get(Number(info.lastInsertRowid), req.user.id) });
  })
);

profilesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Family member not found');
    const name = req.body.name !== undefined ? str(req.body.name) : existing.name;
    if (!name) throw bad('A name is required');
    const relation = req.body.relation !== undefined ? str(req.body.relation) : existing.relation;
    await update.run(name, relation, req.params.id, req.user.id);
    res.json({ profile: await getOne.get(req.params.id, req.user.id) });
  })
);

// Deleting a member keeps their money — everything they held moves to "Me".
profilesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await getOne.get(req.params.id, req.user.id);
    if (!existing) throw new HttpError(404, 'Family member not found');
    await db.batch([
      { sql: 'UPDATE holdings SET profile_id = NULL WHERE user_id = ? AND profile_id = ?', args: [req.user.id, req.params.id] },
      { sql: 'UPDATE cash_accounts SET profile_id = NULL WHERE user_id = ? AND profile_id = ?', args: [req.user.id, req.params.id] },
      { sql: 'UPDATE assets SET profile_id = NULL WHERE user_id = ? AND profile_id = ?', args: [req.user.id, req.params.id] },
    ]);
    await remove.run(req.params.id, req.user.id);
    res.json({ ok: true, moved_to_me: true });
  })
);

/* ------------------------- shared scope helpers ------------------------- */

// ?profile=all (default) | me | <id>. Returns an SQL fragment + args to append
// to a "WHERE user_id = ?" query.
export function scopeFromReq(req) {
  const raw = String(req.query.profile || 'all');
  if (raw === 'all') return { key: 'all', sql: '', args: [] };
  if (raw === 'me') return { key: 'me', sql: ' AND profile_id IS NULL', args: [] };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { key: 'all', sql: '', args: [] };
  return { key: id, sql: ' AND profile_id = ?', args: [id] };
}

// Validate a profile_id sent on create/update; null/undefined → owner ("Me").
export async function normalizeProfileId(userId, value) {
  if (value === undefined || value === null || value === '' || value === 'me') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw bad('profile_id must be a positive id');
  const row = await getOne.get(id, userId);
  if (!row) throw bad("That family member doesn't exist");
  return id;
}
