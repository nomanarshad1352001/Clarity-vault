'use strict';
/**
 * quoteLock — signed, expiring JWT price locks.
 *
 * The server recomputes the full quote from config, then signs it with a
 * dedicated LOCK_SECRET and a fixed expiry (pricing-rules.priceLockDays).
 * Tampering with any digit breaks the HMAC signature; expired tokens are
 * rejected with 410 LOCK_EXPIRED. Verification is done with the separate
 * secret so a leaked session secret cannot forge price locks (and vice versa).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('../errors');
const configStore = require('../configStore');

const LOCK_SECRET = process.env.LOCK_SECRET || 'dev-only-insecure-lock-secret';
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function makeRef() {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return `AQ-${out}`;
}

function createLock(quote, customer) {
  const rules = configStore.getPricingRules();
  const ref = makeRef();
  const expiresAt = new Date(Date.now() + rules.priceLockDays * 24 * 60 * 60 * 1000);
  const token = jwt.sign(
    {
      v: 1,
      typ: 'price_lock',
      ref,
      quote,
      customer: { email: customer.email, name: customer.name || null },
    },
    LOCK_SECRET,
    { expiresIn: `${rules.priceLockDays}d` }
  );
  return { token, ref, expiresAt: expiresAt.toISOString(), quote };
}

function verifyLock(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    throw new AppError(401, 'LOCK_INVALID', 'This price lock is not valid.');
  }
  let payload;
  try {
    payload = jwt.verify(token, LOCK_SECRET);
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      throw new AppError(410, 'LOCK_EXPIRED', 'This price lock has expired. Please build a new quote.');
    }
    throw new AppError(401, 'LOCK_INVALID', 'This price lock is not valid.');
  }
  if (!payload || payload.typ !== 'price_lock' || !payload.quote || !payload.ref) {
    throw new AppError(401, 'LOCK_INVALID', 'This price lock is not valid.');
  }
  return payload;
}

module.exports = { createLock, verifyLock, makeRef };
