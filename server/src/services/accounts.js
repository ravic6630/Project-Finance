import { db } from '../db.js';

// Every table that holds a user's rows by user_id. Deleting an account clears
// them explicitly rather than trusting ON DELETE CASCADE, which libSQL and
// SQLite only honour with foreign keys switched on. A new per-user table
// belongs here, or deleted accounts leave its rows behind.
export const CHILD_TABLES = [
  'holdings', 'cash_accounts', 'assets', 'transactions', 'goals', 'goal_links', 'alerts',
  'net_worth_snapshots', 'investment_txns', 'subscriptions', 'recurring_rules', 'budgets',
  'broker_connections', 'email_prefs', 'password_reset_codes', 'sessions',
  'support_messages', 'profiles', 'insight_prefs', 'allocation_targets', 'goal_prefs',
  'health_prefs',
];

export function deleteAccountStatements(id) {
  return [
    ...CHILD_TABLES.map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [id] })),
    // family_links keys by inviter/invitee, not user_id — clear both directions.
    { sql: 'DELETE FROM family_links WHERE inviter_id = ? OR invitee_id = ?', args: [id, id] },
    { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
  ];
}

// One atomic batch: an account is either all there or all gone.
export const deleteAccount = (id) => db.batch(deleteAccountStatements(id));
