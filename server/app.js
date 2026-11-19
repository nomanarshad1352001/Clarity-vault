'use strict';
/**
 * app — assembles the Express application.
 *
 * Two ways to run the SAME app:
 *  1. Hosted (this sandbox): mounted by pages/api/[[...all]].js under Next.js.
 *     CSP/headers come from next.config.ts.
 *  2. Standalone (Docker/Render/Railway): `node server/index.js` — serves the
 *     /public frontend itself and applies helmet with the shared CSP.
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { attachUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFoundApi, errorHandler } = require('./errors');
const { CSP } = require('./securityHeaders');

function createApp({ standalone = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  if (standalone) {
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    // Apply our strict shared CSP (helmet's default is too loose for this app):
    app.use((req, res, next) => {
      res.setHeader('Content-Security-Policy', CSP);
      next();
    });
  }

  app.use(compression());

  // Stripe webhook needs the raw body BEFORE any JSON parsing (signature check).
  app.use('/api/payments/webhook', express.raw({ type: 'application/json', limit: '256kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.use('/api', apiLimiter, csrfProtection);

  app.use('/api', require('./routes/misc'));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/catalog', require('./routes/catalog'));
  app.use('/api/quote', require('./routes/quote'));
  app.use('/api/payments', require('./routes/payments'));
  app.use('/api/financing', require('./routes/financing'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/address', require('./routes/address'));
  app.use('/api', notFoundApi);

  if (standalone) {
    const publicDir = path.join(process.cwd(), 'public');
    const pages = {
      '/login': 'login.html',
      '/quote': 'quote.html',
      '/sales': 'sales.html',
      '/admin': 'admin.html',
      '/verify': 'verify.html',
      '/payment/success': 'payment-success.html',
    };
    app.get('/', (req, res) => res.redirect('/login'));
    for (const [route, file] of Object.entries(pages)) {
      app.get(route, (req, res) => res.sendFile(path.join(publicDir, file)));
    }
    app.use(
      express.static(publicDir, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else res.setHeader('Cache-Control', 'public, max-age=3600');
        },
      })
    );
    app.use((req, res) => res.status(404).send('Not found'));
  }

  app.use(errorHandler);
  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
