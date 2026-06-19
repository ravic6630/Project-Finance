import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { PORT } from './config.js';
import { initDb } from './db.js';
import { authRouter } from './routes/auth.js';
import { holdingsRouter } from './routes/holdings.js';
import { cashRouter } from './routes/cash.js';
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
import { startDigestScheduler } from './services/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
// Capture the raw body so the Razorpay webhook can verify its HMAC signature.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Sampada API' }));

app.use('/api/auth', authRouter);
app.use('/api/holdings', holdingsRouter);
app.use('/api/cash', cashRouter);
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

// Unknown API route -> JSON 404 (so the SPA fallback never swallows it).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend in production (after `npm run build`).
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

// Central error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

await initDb();
app.listen(PORT, () => {
  console.log(`Sampada API listening on http://localhost:${PORT}`);
  startDigestScheduler();
});
