import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { PORT } from './config.js';
import { initDb } from './db.js';
import { warmMfList } from './services/prices.js';
import { authRouter } from './routes/auth.js';
import { holdingsRouter } from './routes/holdings.js';
import { cashRouter } from './routes/cash.js';
import { assetsRouter } from './routes/assets.js';
import { transactionsRouter } from './routes/transactions.js';
import { dashboardRouter } from './routes/dashboard.js';
import { pricesRouter } from './routes/prices.js';
import { importRouter } from './routes/import.js';
import { brokerRouter } from './routes/broker.js';
import { billingRouter } from './routes/billing.js';
import { emailRouter } from './routes/email.js';
import { cronRouter } from './routes/cron.js';
import { goalsRouter } from './routes/goals.js';
import { alertsRouter } from './routes/alerts.js';
import { returnsRouter } from './routes/returns.js';
import { adminRouter } from './routes/admin.js';
import { supportRouter } from './routes/support.js';
import { exportRouter } from './routes/export.js';
import { recurringRouter } from './routes/recurring.js';
import { budgetsRouter } from './routes/budgets.js';
import { profilesRouter } from './routes/profiles.js';
import { familyRouter } from './routes/family.js';
import { statementsRouter } from './routes/statements.js';
import { insightsRouter } from './routes/insights.js';
import { startDigestScheduler } from './services/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
// Gzip everything compressible — dashboard JSON (history arrays) and the JS
// bundles shrink 60-80%, which matters a lot on Render's free tier.
app.use(compression());
app.use(cors());
// Capture the raw body so the Razorpay webhook can verify its HMAC signature.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Sampada API' }));

app.use('/api/auth', authRouter);
app.use('/api/holdings', holdingsRouter);
app.use('/api/cash', cashRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/import', importRouter);
app.use('/api/broker', brokerRouter);
app.use('/api/billing', billingRouter);
app.use('/api/email', emailRouter);
app.use('/api/cron', cronRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/support', supportRouter);
app.use('/api/export', exportRouter);
app.use('/api/recurring', recurringRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/family', familyRouter);
app.use('/api/statements', statementsRouter);
app.use('/api/insights', insightsRouter);

// Unknown API route -> JSON 404 (so the SPA fallback never swallows it).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend in production (after `npm run build`).
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  // Vite content-hashes everything under /assets — safe to cache forever.
  // index.html (and the PWA manifest/icons at the root) must stay fresh so a
  // deploy is picked up on the next load.
  app.use(
    express.static(webDist, {
      setHeaders(res, path) {
        if (path.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(webDist, 'index.html'));
  });
}

// Central error handler.
 
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  // 4xx messages are written for humans; 5xx ones are internals (SQL text,
  // file paths, driver errors) and must not reach the client.
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong on our side — please try again.' : err.message || 'Request failed',
  });
});

await initDb();
app.listen(PORT, () => {
  console.log(`Sampada API listening on http://localhost:${PORT}`);
  startDigestScheduler();
  // Pull the AMFI scheme list in the background so the first mutual-fund import
  // after a (re)start doesn't wait on a ~5 MB download. Non-blocking; failures
  // are ignored and it's re-fetched lazily on demand.
  warmMfList();
});
