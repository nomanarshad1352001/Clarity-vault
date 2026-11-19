'use strict';
/**
 * Signed, expiring JWTs.
 *  - price-lock tokens: audience "price-lock", signed with the lock secret
 *  - session tokens:    audience "session",    signed with the session secret
 * Different secrets AND audiences mean one can never be replayed as the other.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

class TokenError extends Error {
  constructor(code, message) { super(message); this.name = 'TokenError'; this.code = code; }
}

function verify(token, secret, audience) {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'], audience, issuer: 'ac-quote' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new TokenError('expired', 'This price lock has expired');
    throw new TokenError('invalid', 'Invalid token');
  }
}

function signLock(payload, { expiresInSec }) {
  return jwt.sign(payload, config.secrets.lock, { algorithm: 'HS256', audience: 'price-lock', issuer: 'ac-quote', expiresIn: expiresInSec, jwtid: payload.ref });
}

const REF_RE = /^AC-[A-Z0-9]{8}$/;

function verifyLock(token) {
  const p = verify(token, config.secrets.lock, 'price-lock');
  if (!p.ref || !REF_RE.test(p.ref) || p.jti !== p.ref || !p.quote || !Number.isInteger(p.quote.totalCents)) {
    throw new TokenError('invalid', 'Malformed price lock');
  }
  return p;
}

function signSession(user) {
  return jwt.sign({ role: user.role, name: user.name }, config.secrets.session, {
    algorithm: 'HS256', audience: 'session', issuer: 'ac-quote', subject: user.email, expiresIn: `${config.sessionHours}h`,
  });
}

function verifySession(token) {
  const p = verify(token, config.secrets.session, 'session');
  return { email: p.sub, role: p.role, name: p.name };
}

module.exports = { TokenError, signLock, verifyLock, signSession, verifySession, REF_RE };
