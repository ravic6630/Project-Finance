import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler, bad } from '../util.js';
import { availableMonths, statementData, statementHtml } from '../services/statement.js';

export const statementsRouter = Router();
statementsRouter.use(authRequired);

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const currentYM = () => new Date().toISOString().slice(0, 7);

function assertYm(ym) {
  if (!YM_RE.test(ym)) throw bad('Month must look like 2026-07');
  if (ym > currentYM()) throw bad("That month hasn't happened yet");
  if (ym < '2000-01') throw bad('Month is too far in the past');
}

// Months a statement can cover (newest first, up to 12).
statementsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ months: await availableMonths(req.user) });
  })
);

// The statement itself, as a self-contained printable page. The client opens
// it in a new tab; "Save as PDF" is the browser's print dialog.
statementsRouter.get(
  '/:ym/html',
  asyncHandler(async (req, res) => {
    const ym = String(req.params.ym);
    assertYm(ym);
    const data = await statementData(req.user, ym);
    res.type('html').send(statementHtml(req.user, data, { forPrint: true }));
  })
);

