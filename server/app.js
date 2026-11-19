'use strict';
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const { securityHeaders, requestLogger, noStoreApi } = require('./middleware/security');
const { createLimiters } = require('./middleware/rateLimits');
const { csrf } = require('./middleware/csrf');
const { attachUser, requireRolePage } = require('./middleware/auth');
const { notFoundApi, errorHandler } = require('./middleware/errorHandler');
const { createAuthRouter } = require('./routes/auth');
const publicRoutes = require('./routes/public');
const quoteRoutes = require('./routes/quote');
const payment = require('./routes/payment');
const staff = require('./routes/staff');

const PUBLIC = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  const limits = createLimiters();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders());
  app.use(compression());

  // Health check: before rate limits / logging so platform probes are never throttled.
  const health = (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
  app.get(['/health', '/api/health'], health);

  app.use(requestLogger);

  // Webhooks need the raw body, so they are mounted before express.json(). No cookies / CSRF here: authenticated by signature.
  app.use('/api/webhooks', limits.webhook, payment.webhookRouter);

  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use('/api', noStoreApi, limits.api, csrf);
  app.get('/api/csrf', (req, res) => res.json({ token: req.cookies.csrf_token }));

  app.use('/api/auth', createAuthRouter({ loginLimiter: limits.login }));
  app.use('/api', publicRoutes);
  app.use('/api/quote/lock', limits.lock);
  app.use(['/api/quote', '/api/financing', '/api/payment'], limits.quote);
  app.use('/api', quoteRoutes);
  app.use('/api/payment', payment.router);
  app.use('/api/sales', staff.sales);
  app.use('/api/admin', staff.admin);
  app.use('/api', notFoundApi);

  // Role-protected pages (the APIs behind them are independently protected).
  app.get(['/sales', '/sales.html'], requireRolePage('sales', 'admin'), (req, res) => res.sendFile(path.join(PUBLIC, 'sales.html')));
  app.get(['/admin', '/admin.html'], requireRolePage('admin'), (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));

  app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
