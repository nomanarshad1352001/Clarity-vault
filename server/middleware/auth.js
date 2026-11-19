'use strict';
/**
 * auth middleware — signed JWT session in an httpOnly, sameSite cookie.
 * Session payload: { sub, email, name, role }. No server-side session store.
 */
const jwt = require('jsonwebtoken');
const { AppError } = require('../errors');

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'ad_session';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const SESSION_TTL = '8h';

function signSession(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}

function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/** Parses the session cookie (if any) and attaches req.user + req.sessionToken. */
function attachUser(req, _res, next) {
  req.user = null;
  req.sessionToken = null;
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      req.sessionToken = token;
    } catch {
      /* expired/tampered session → treated as logged out */
    }
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue.'));
  return next();
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'AUTH_REQUIRED', 'Please sign in to continue.'));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'Your role is not allowed to do that.'));
    }
    return next();
  };
}

function roleHome(role) {
  if (role === 'sales') return '/sales';
  if (role === 'admin') return '/admin';
  return '/quote';
}

module.exports = {
  COOKIE_NAME,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireRole,
  roleHome,
};
