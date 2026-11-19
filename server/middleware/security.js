'use strict';
const helmet = require('helmet');
const config = require('../config');
const log = require('../services/logger');

/** Strict CSP: no inline scripts or styles, no third-party origins. */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        ...(config.forceHttps ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    strictTransportSecurity: config.forceHttps ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
}

/** Request log without bodies, query strings or headers (they may contain PII / tokens). */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/api/health') return;
    log.info('request', { method: req.method, path: req.path.replace(/AC-[A-Z0-9]{8}/g, 'AC-********'), status: res.statusCode, ms: Date.now() - start });
  });
  next();
}

/** Responses from /api must never be cached by browsers or proxies. */
function noStoreApi(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { securityHeaders, requestLogger, noStoreApi };
