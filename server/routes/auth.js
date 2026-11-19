'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../schemas');
const { loginLimiter } = require('../middleware/rateLimit');
const { signSession, setSessionCookie, clearSessionCookie, roleHome } = require('../middleware/auth');
const { tokenForSession } = require('../middleware/csrf');
const { AppError, asyncWrap } = require('../errors');
const configStore = require('../configStore');
const store = require('../services/store');

const router = express.Router();

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncWrap(async (req, res) => {
    const { email, password } = req.body;
    const user = configStore.getDemoUsers().find((u) => u.email === email);
    const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!ok) {
      store.addAudit({ type: 'LOGIN_FAILED', actor: 'anonymous', summary: 'Failed sign-in attempt', meta: { email } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const token = signSession(user);
    setSessionCookie(req, res, token);
    store.addAudit({ type: 'LOGIN', actor: user.email, summary: `${user.role} signed in` });
    res.json({
      user: { email: user.email, name: user.name, role: user.role },
      csrfToken: tokenForSession(token),
      redirect: roleHome(user.role),
    });
  })
);

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Not signed in.' } });
  }
  return res.json({
    user: { email: req.user.email, name: req.user.name, role: req.user.role },
    csrfToken: tokenForSession(req.sessionToken),
  });
});

module.exports = router;
