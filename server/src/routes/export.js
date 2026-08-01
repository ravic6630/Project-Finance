import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';
import { asyncHandler } from '../util.js';
import { premiumState } from '../services/billing.js';

export const exportRouter = Router();
exportRouter.use(authRequired);

// Everything the user owns, one JSON download. user_id is dropped from every
// row (it's implicit), and broker access tokens are deliberately NOT included —
// only the fact that a broker was connected, and when.
const OWNED_TABLES = [
  'holdings',
  'cash_accounts',
  'assets',
  'transactions',
  'goals',
  'alerts',
  'investment_txns',
  'net_worth_snapshots',
  'support_messages',
];

const stripUserId = ({ user_id, ...rest }) => rest;

exportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const state = await premiumState(req.user);

    const data = {};
    for (const table of OWNED_TABLES) {
      const rows = await db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(uid);
      data[table] = rows.map(stripUserId);
    }

    const prefs = await db.prepare('SELECT daily FROM email_prefs WHERE user_id = ?').get(uid);
    const brokers = await db
      .prepare('SELECT broker, updated_at FROM broker_connections WHERE user_id = ?')
      .all(uid);

    const payload = {
      app: 'Sampada',
      format_version: 1,
      exported_at: new Date().toISOString(),
      account: {
        email: req.user.email,
        name: req.user.name,
        base_currency: req.user.base_currency,
        created_at: req.user.created_at,
        plan: state.plan,
        premium_until: state.until,
      },
      preferences: { daily_email: !!prefs?.daily },
      broker_connections: brokers.map((b) => ({ broker: b.broker, connected_at: b.updated_at })),
      ...data,
    };

    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="sampada-export-${day}.json"`);
    res.json(payload);
  })
);
