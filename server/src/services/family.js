import { db } from '../db.js';
import { HttpError } from '../util.js';
import { buildSummary } from './summary.js';

// Linked REAL accounts (family_links, status=active), as user rows. Pairwise
// and direction-agnostic: an accepted link makes each side a member of the
// other's family view.
const membersStmt = db.prepare(`
  SELECT u.id, u.name, u.email, u.base_currency
  FROM family_links l
  JOIN users u ON u.id = CASE WHEN l.inviter_id = ? THEN l.invitee_id ELSE l.inviter_id END
  WHERE l.status = 'active' AND (l.inviter_id = ? OR l.invitee_id = ?)
  ORDER BY l.accepted_at
`);

export async function linkedMembers(userId) {
  return membersStmt.all(userId, userId, userId);
}

export async function isLinked(userId, otherId) {
  const rows = await linkedMembers(userId);
  return rows.some((m) => m.id === Number(otherId));
}

// Family view shows BALANCE SHEET only (holdings/cash/assets → net worth).
// Cash-flow (transactions), goals and budgets stay private to each login.
const emptyCashflow = () => {
  const months = [];
  const ref = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, income: 0, expense: 0 });
  }
  return { months, this_month_income: 0, this_month_expense: 0, this_month_net: 0 };
};

// A member's summary, converted directly to the VIEWER's base currency (each
// row converts from its own currency — no double hop through their base).
async function memberSummary(viewer, member, { refresh = false } = {}) {
  const s = await buildSummary({ ...member, base_currency: viewer.base_currency }, { refresh, scope: null });
  s.cashflow = emptyCashflow();
  s.counts = { ...s.counts, transactions: 0, goals: 0 };
  s.setup = { imported: true, daily_email: true }; // never nudge inside a read-only view
  return s;
}

// Read-only view of one linked member's dashboard. 404s unless an ACTIVE link
// exists — revoking a link cuts this off instantly.
export async function buildMemberView(viewer, memberId, { refresh = false } = {}) {
  const member = (await linkedMembers(viewer.id)).find((m) => m.id === Number(memberId));
  if (!member) throw new HttpError(404, 'That family member is not linked to your account.');
  const s = await memberSummary(viewer, member, { refresh });
  s.family = { viewing: { user_id: member.id, name: member.name || member.email } };
  return s;
}

const sumByKey = (into, rows, keyName) => {
  const map = new Map(into.map((r) => [r[keyName], r]));
  for (const r of rows) {
    const hit = map.get(r[keyName]);
    if (hit) {
      hit.value += r.value;
      if (r.cost != null) hit.cost = (hit.cost || 0) + r.cost;
      hit.count += r.count;
    } else {
      const copy = { ...r };
      into.push(copy);
      map.set(copy[keyName], copy);
    }
  }
  return into;
};

// Everyone = my whole account (incl. managed profiles) + each linked member's
// whole account, all in my base currency. Balance-sheet numbers merge;
// cashflow/goals/setup stay MINE.
export async function buildFamilySummary(viewer, own, members, { refresh = false } = {}) {
  const merged = {
    ...own,
    investments: { ...own.investments, by_kind: own.investments.by_kind.map((k) => ({ ...k })) },
    cash: { ...own.cash, by_type: own.cash.by_type.map((t) => ({ ...t })) },
    assets: { ...own.assets, by_type: own.assets.by_type.map((t) => ({ ...t })) },
    counts: { ...own.counts },
  };
  const included = [];
  for (const m of members) {
    const s = await memberSummary(viewer, m, { refresh: false }); // members ride the price cache
    merged.net_worth += s.net_worth;
    merged.investments.value += s.investments.value;
    merged.investments.cost += s.investments.cost;
    sumByKey(merged.investments.by_kind, s.investments.by_kind, 'key');
    merged.cash.total += s.cash.total;
    sumByKey(merged.cash.by_type, s.cash.by_type, 'type');
    merged.assets.total += s.assets.total;
    sumByKey(merged.assets.by_type, s.assets.by_type, 'type');
    merged.counts.holdings += s.counts.holdings;
    merged.counts.accounts += s.counts.accounts;
    merged.counts.assets += s.counts.assets;
    merged.rates = { ...s.rates, ...merged.rates }; // expose members' currencies; mine win
    included.push({ user_id: m.id, name: m.name || m.email });
  }
  merged.investments.gain = merged.investments.value - merged.investments.cost;
  merged.investments.gain_pct =
    merged.investments.cost > 0 ? (merged.investments.gain / merged.investments.cost) * 100 : 0;
  merged.allocation = [
    ...merged.investments.by_kind.map((k) => ({ key: k.key, label: k.label, value: k.value })),
    ...(merged.cash.total > 0 ? [{ key: 'CASH', label: 'Cash & Bank', value: merged.cash.total }] : []),
    ...(merged.assets.total > 0 ? [{ key: 'ASSETS', label: 'Assets', value: merged.assets.total }] : []),
  ].filter((a) => a.value > 0);
  merged.family = { included };
  return merged;
}

// Sum several {date, net_worth} series into one. Union of dates; each series
// carries its last known value forward (and counts 0 before its first point),
// so one member's missing day never dents the family line.
export function mergeHistorySeries(seriesList) {
  const lists = seriesList.filter((s) => Array.isArray(s) && s.length);
  if (!lists.length) return [];
  if (lists.length === 1) return lists[0];
  const dates = [...new Set(lists.flat().map((p) => p.date))].sort();
  const idx = lists.map(() => 0);
  const last = lists.map(() => 0);
  return dates.map((date) => {
    let total = 0;
    for (let i = 0; i < lists.length; i += 1) {
      while (idx[i] < lists[i].length && lists[i][idx[i]].date <= date) {
        last[i] = lists[i][idx[i]].net_worth;
        idx[i] += 1;
      }
      total += last[i];
    }
    return { date, net_worth: total };
  });
}
