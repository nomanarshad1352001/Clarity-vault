'use strict';
const tokens = require('../services/tokens');

/** Reads the httpOnly session cookie and sets req.user (or null). Never throws. */
function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies && req.cookies.session;
  if (token) {
    try { req.user = tokens.verifySession(token); } catch { res.clearCookie('session', { path: '/' }); }
  }
  next();
}

/** API guard: 401 if not signed in, 403 if the role is not allowed. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated', message: 'Please sign in.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden', message: 'You do not have access to this.' });
    next();
  };
}

/** Page guard: redirects to /login instead of returning JSON. */
function requireRolePage(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.path.replace('.html', ''))}`);
    if (!roles.includes(req.user.role)) return res.redirect('/login?denied=1');
    next();
  };
}

const HOME = { homeowner: '/quote', sales: '/sales', admin: '/admin' };

module.exports = { attachUser, requireRole, requireRolePage, HOME };
