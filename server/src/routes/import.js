import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../auth.js';
import { asyncHandler, bad } from '../util.js';
import { casAvailable, parseCasBuffer, selfTest } from '../services/cas.js';
import {
  dedupSets,
  insertImportedHoldings,
  normalizeStockSymbol,
  resolveName,
} from '../services/importer.js';
import { FREE_HOLDINGS_LIMIT, premiumState } from '../services/billing.js';
import { buildCsvPreview } from '../services/csvImport.js';

export const importRouter = Router();
importRouter.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// Turn the parser's normalized output into a review list, flagging duplicates.
async function buildPreview(parsed, userId) {
  const have = await dedupSets(userId);
  const mfsRaw = parsed.mutualFunds || [];
  const stocksRaw = parsed.stocks || [];

  // Replace the statement's cruft-filled names with clean canonical ones
  // (Yahoo / AMFI). Resolved in parallel; this also warms the price cache.
  const [mfNames, stockNames] = await Promise.all([
    Promise.all(mfsRaw.map((m) => resolveName('IN_MF', { schemeCode: m.amfi || '' }, m.name))),
    Promise.all(
      stocksRaw.map((s) =>
        resolveName(
          'IN_STOCK',
          { symbol: s.symbol ? normalizeStockSymbol('IN_STOCK', s.symbol, s.exchange) : '' },
          s.name
        )
      )
    ),
  ]);

  const items = [];
  mfsRaw.forEach((m, i) => {
    items.push({
      kind: 'IN_MF',
      scheme_code: m.amfi || '',
      name: mfNames[i],
      quantity: m.units || 0,
      avg_cost: m.avgCost ?? m.nav ?? 0,
      currency: 'INR',
      isin: m.isin || null,
      folio: m.folio || null,
      value: m.value ?? null,
      // MFs usually carry a real cost in the statement; flag as estimate only when they don't.
      cost_is_estimate: !(Number(m.cost) > 0 || (Number(m.avgCost) > 0 && Number(m.avgCost) !== Number(m.nav))),
      duplicate: m.amfi ? have.mf.has(String(m.amfi)) : false,
      importable: !!m.amfi,
      note: m.amfi ? null : 'No AMFI code in statement — add manually to track live NAV',
    });
  });
  stocksRaw.forEach((s, i) => {
    const symbol = s.symbol || '';
    const normalized = symbol ? normalizeStockSymbol('IN_STOCK', symbol, s.exchange) : '';
    items.push({
      kind: 'IN_STOCK',
      symbol,
      exchange: s.exchange || null,
      name: stockNames[i],
      quantity: s.quantity || 0,
      avg_cost: s.avgCost ?? s.nav ?? 0,
      currency: 'INR',
      isin: s.isin || null,
      value: s.value ?? null,
      // CDSL never reports a stock buy price — avg is the current price, an estimate.
      cost_is_estimate: true,
      duplicate: symbol ? have.sym.has(normalized) : false,
      importable: true,
      needsSymbol: !symbol,
      note: symbol
        ? null
        : 'Confirm the NSE ticker (e.g. RELIANCE) so we can fetch its live price',
    });
  });
  return {
    investor: parsed.investor || null,
    file_type: parsed.fileType || null,
    items,
    summary: {
      mutualFunds: items.filter((i) => i.kind === 'IN_MF').length,
      stocks: items.filter((i) => i.kind === 'IN_STOCK').length,
      duplicates: items.filter((i) => i.duplicate).length,
    },
  };
}

const FRIENDLY = {
  not_installed: "CAS import isn't set up on this server yet. Run server/tools/cas/setup.sh.",
  bad_password: 'That password did not unlock the PDF. Use the password your CAS was protected with.',
  unsupported_file:
    "That file couldn't be read as a CAS. Upload the ORIGINAL statement PDF emailed by CDSL/NSDL or CAMS/KFintech (re-saved/printed PDFs don't work).",
  sidecar_error: 'Could not read the statement. Please try the original CAS PDF again.',
  parse_error: 'Could not read the statement. Please try the original CAS PDF again.',
};

importRouter.get('/cas/status', (_req, res) => res.json({ available: casAvailable() }));

importRouter.post(
  '/cas/demo',
  asyncHandler(async (req, res) => {
    const parsed = await selfTest();
    if (!parsed.ok) throw bad(FRIENDLY[parsed.errorType] || parsed.error);
    res.json(await buildPreview(parsed, req.user.id));
  })
);

importRouter.post(
  '/cas',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!casAvailable()) return res.status(503).json({ error: FRIENDLY.not_installed });
    if (!req.file) throw bad('Please choose a CAS PDF file to upload');
    const parsed = await parseCasBuffer(req.file.buffer, req.body.password || '');
    if (!parsed.ok) {
      const status = parsed.errorType === 'not_installed' ? 503 : 400;
      console.error(
        '[CAS parse failed]', parsed.errorType, '| casparser', parsed.casparser,
        '|', parsed.error, '| where:', parsed.where, '| all:', parsed.allErrors, '\n', parsed.trace || ''
      );
      let msg = FRIENDLY[parsed.errorType] || parsed.error;
      // Surface a short technical hint for unexpected failures (helps reporting).
      if ((parsed.errorType === 'parse_error' || parsed.errorType === 'sidecar_error') && parsed.error) {
        const where = parsed.where ? ` at ${parsed.where}` : '';
        msg += ` (details: ${String(parsed.error).slice(0, 140)}${where})`;
      }
      return res.status(status).json({ error: msg });
    }
    const preview = await buildPreview(parsed, req.user.id);
    if (parsed.debug) console.warn('[CAS parsed but empty]', JSON.stringify(parsed.debug), 'casparser', parsed.casparser);
    res.json(preview);
  })
);

// Generic CSV holdings import (any broker, any country). The user picks the
// market; we map the columns and preview, then reuse /confirm to import.
importRouter.post(
  '/csv/preview',
  asyncHandler(async (req, res) => {
    res.json(
      await buildCsvPreview(
        { text: String(req.body.csv || ''), kind: req.body.kind, mapping: req.body.mapping },
        req.user.id
      )
    );
  })
);

// Generic confirm — used by BOTH CAS and broker imports (same item shape).
const confirm = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.items) ? req.body.items : [];
  if (rows.length === 0) throw bad('No holdings selected to import');
  const premium = (await premiumState(req.user)).premium;
  res.json(
    await insertImportedHoldings(req.user.id, rows, req.body.source || 'Imported', {
      maxTotal: premium ? null : FREE_HOLDINGS_LIMIT,
    })
  );
});

importRouter.post('/confirm', confirm);
importRouter.post('/cas/confirm', confirm); // back-compat alias
