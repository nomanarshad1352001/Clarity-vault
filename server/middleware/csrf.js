'use strict';
/**
 * CSRF protection for cookie-authenticated mutations.
 *
 * The CSRF token is an HMAC of the raw session JWT, so it is stateless:
 * the client receives it from /api/auth/login or /api/auth/me and must send it
 * back as the `x-csrf-token` header on every cookie-authenticated
 * POST/PUT/PATCH/DELETE. Cross-site attackers cannot read the token
 * (httpOnly cookie + same-origin JSON endpoint), so forged requests fail.
 *
 * Exempt paths: login (no session yet, protected by rate limit + SameSite
 * cookie) and the Stripe webhook (authenticated by Stripe's own signature).
 */
const crypto = require('crypto');
const { AppError } = require('../errors');

const CSRF_SECRET = process.env.CSRF_SECRET || 'dev-only-insecure-csrf-secret';
const EXEMPT_PATHS = new Set(['/api/auth/login', '/api/payments/webhook']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokenForSession(sessionToken) {
  return crypto.createHmac('sha256', CSRF_SECRET).update(String(sessionToken)).digest('hex');
}

function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.user || !req.sessionToken) return next(); // not cookie-authenticated
  const path = (req.baseUrl || '') + req.path;
  if (EXEMPT_PATHS.has(path) || EXEMPT_PATHS.has(req.path)) return next();
  const sent = req.get('x-csrf-token') || '';
  const expected = tokenForSession(req.sessionToken);
  const a = Buffer.from(String(sent));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new AppError(403, 'CSRF_FAILED', 'Security check failed. Refresh the page and try again.'));
  }
  return next();
}

module.exports = { csrfProtection, tokenForSession };
