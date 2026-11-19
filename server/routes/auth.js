'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const tokens = require('../services/tokens');
const audit = require('../services/audit');
const { loginSchema } = require('../services/schemas');
const { wrap } = require('../middleware/errorHandler');
const { HOME } = require('../middleware/auth');

const USERS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'demo-users.json'), 'utf8')).users;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // equalises timing for unknown emails

// Per-account lockout (defends against distributed brute force that rotates IPs).
const failures = new Map();
const LOCK_MS = 15 * 60_000;

function lockedUntil(email) {
  const f = failures.get(email);
  return f && f.until && f.until > Date.now() ? f.until : 0;
}
function recordFailure(email) {
  const f = failures.get(email) || { count: 0, until: 0 };
  if (f.until && f.until <= Date.now()) { f.count = 0; f.until = 0; }
  f.count++;
  if (f.count >= config.rate.loginLockoutAfter) f.until = Date.now() + LOCK_MS;
  failures.set(email, f);
}

const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.sessionHours * 3600_000 });

function createAuthRouter({ loginLimiter }) {
  const router = express.Router();

  router.post('/login', loginLimiter, wrap(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    if (lockedUntil(email)) {
      audit.record('login_locked', email, null, {});
      return res.status(429).json({ error: 'account_locked', message: 'Too many failed attempts. Try again in 15 minutes.' });
    }
    const user = USERS.find((u) => u.email === email);
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) {
      recordFailure(email);
      audit.record('login_failed', email, null, {});
      return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    }
    failures.delete(email);
    res.cookie('session', tokens.signSession(user), cookieOpts());
    audit.record('login', user.email, null, { role: user.role });
    res.json({ user: { email: user.email, name: user.name, role: user.role }, redirect: HOME[user.role] });
  }));

  router.post('/logout', (req, res) => {
    res.clearCookie('session', { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated', message: 'Not signed in.' });
    res.json({ user: { email: req.user.email, name: req.user.name, role: req.user.role } });
  });

  return router;
}

module.exports = { createAuthRouter, resetLockouts: () => failures.clear() };
