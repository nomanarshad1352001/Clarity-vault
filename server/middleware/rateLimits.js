'use strict';
const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const make = (windowMs, limit, message, extra = {}) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'rate_limited', message }),
  ...extra,
});

/** Create fresh limiter instances per app (keeps tests isolated). */
function createLimiters() {
  return {
    api: make(60_000, config.rate.apiPerMin, 'Too many requests. Please slow down.'),
    quote: make(60_000, config.rate.quotePerMin, 'Too many quote requests. Please wait a minute.'),
    lock: make(60_000, config.rate.lockPerMin, 'Too many price-lock attempts. Please wait a minute.'),
    // Only failed logins count toward the limit.
    login: make(15 * 60_000, config.rate.loginPer15Min, 'Too many login attempts. Try again in 15 minutes.', { skipSuccessfulRequests: true }),
    webhook: make(60_000, 300, 'Too many webhook calls.'),
  };
}

module.exports = { createLimiters };
