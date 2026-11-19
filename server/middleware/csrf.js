'use strict';
/**
 * CSRF protection for cookie-authenticated requests: signed double-submit token + Origin check.
 *  - GET /api/csrf (or any API GET) sets a `csrf_token` cookie (readable by JS) containing "<random>.<hmac>".
 *  - Unsafe methods must send the same value in the `X-CSRF-Token` header.
 *  - The HMAC stops an attacker who can only inject cookies from forging a valid pair.
 *  - If an Origin header is present it must match the request host.
 * The payment webhook is exempt (it is authenticated by its signature, not a cookie).
 */
const crypto = require('crypto');
const config = require('../config');

const sign = (rand) => crypto.createHmac('sha256', config.secrets.csrf).update(rand).digest('hex');
const issue = () => { const r = crypto.randomBytes(24).toString('hex'); return `${r}.${sign(r)}`; };

function valid(token) {
  if (typeof token !== 'string') return false;
  const [rand, mac] = token.split('.');
  if (!rand || !mac) return false;
  const a = Buffer.from(mac); const b = Buffer.from(sign(rand));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrf(req, res, next) {
  let cookieToken = req.cookies && req.cookies.csrf_token;
  if (!valid(cookieToken)) {
    cookieToken = issue();
    res.cookie('csrf_token', cookieToken, { httpOnly: false, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
    req.cookies.csrf_token = cookieToken;
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.get('origin');
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    if (host !== req.get('host')) return res.status(403).json({ error: 'csrf_invalid', message: 'Cross-origin request blocked' });
  }
  const header = req.get('x-csrf-token');
  const ok = header && header.length === cookieToken.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(cookieToken));
  if (!ok) return res.status(403).json({ error: 'csrf_invalid', message: 'Missing or invalid CSRF token' });
  next();
}

module.exports = { csrf, issue, valid };
