'use strict';
/**
 * rateLimit — small in-memory fixed-window limiter (no external deps).
 * Global limiter for all /api traffic, plus stricter buckets for login and
 * quote endpoints. Buckets live on globalThis so they survive module reloads.
 */
const { AppError } = require('../errors');
const logger = require('../logger');

const g = (globalThis.__airedirect = globalThis.__airedirect || {});
g.rateBuckets = g.rateBuckets || new Map();
const buckets = g.rateBuckets;

let sweeper = null;
function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }, 60 * 1000);
  if (sweeper.unref) sweeper.unref();
}

function createRateLimiter({ windowMs, max, name }) {
  ensureSweeper();
  return (req, _res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      logger.warn('rate_limited', { bucket: name, ip, count: b.count });
      return next(
        new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.')
      );
    }
    return next();
  };
}

const apiLimiter = createRateLimiter({
  name: 'api',
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX || 600),
});
const loginLimiter = createRateLimiter({
  name: 'login',
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_MAX || 10),
});
const quoteLimiter = createRateLimiter({
  name: 'quote',
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_QUOTE_MAX || 60),
});

module.exports = { createRateLimiter, apiLimiter, loginLimiter, quoteLimiter };
