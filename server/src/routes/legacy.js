import { Router } from 'express';
import { authRequired } from '../auth.js';
import { asyncHandler, HttpError } from '../util.js';
import {
  assertMapAccess,
  legacySettings,
  moneyMap,
  moneyMapHtml,
  nomineeAudit,
  setNominee,
  updateLegacySettings,
} from '../services/legacy.js';

export const legacyRouter = Router();
legacyRouter.use(authRequired);

/* --------------------------------- settings ------------------------------- */
legacyRouter.get(
  '/settings',
  asyncHandler(async (req, res) => res.json(await legacySettings(req.user.id)))
);

// Full replace — the page always sends the whole form. Any change re-arms the
// switch from zero (see the service), so there is no partial "just the note".
legacyRouter.put(
  '/settings',
  asyncHandler(async (req, res) => res.json(await updateLegacySettings(req.user.id, req.body || {})))
);

/* ------------------------------ nominee audit ----------------------------- */
legacyRouter.get(
  '/nominees',
  asyncHandler(async (req, res) => res.json(await nomineeAudit(req.user.id)))
);

legacyRouter.post(
  '/nominees',
  asyncHandler(async (req, res) => res.json(await setNominee(req.user.id, req.body || {})))
);

/* --------------------------------- the map -------------------------------- */
// Whose map: your own by default, or an owner who named you — only once their
// switch has fired. The service decides; 404 for anyone it isn't for.
function ownerIdFrom(req) {
  const raw = req.params.userId;
  if (raw == null || raw === 'me') return req.user.id;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found');
  return id;
}

// Printable document — the thing a family actually keeps. Declared BEFORE the
// generic /map/:userId route: Express matches in order, and '/map/print' would
// otherwise be read as a map for a user called "print".
legacyRouter.get(
  ['/map/print', '/map/:userId/print'],
  asyncHandler(async (req, res) => {
    const ownerId = ownerIdFrom(req);
    const { role } = await assertMapAccess(req.user.id, ownerId);
    const map = await moneyMap(ownerId);
    res.type('html').send(moneyMapHtml(map, { viewerRole: role }));
  })
);

legacyRouter.get(
  ['/map', '/map/:userId'],
  asyncHandler(async (req, res) => {
    const ownerId = ownerIdFrom(req);
    const { role } = await assertMapAccess(req.user.id, ownerId);
    res.json({ role, map: await moneyMap(ownerId) });
  })
);
