'use strict';
/**
 * Unit tests for signed, expiring JWT price locks:
 * roundtrip, tamper resistance, wrong secret, wrong token type, expiry.
 */
process.env.LOCK_SECRET = 'test-lock-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { createLock, verifyLock } = require('../server/services/quoteLock');

const QUOTE = {
  system: { id: 'goodman-good', brand: 'Goodman', name: 'GSX14 Value', tons: 2.5, price: 5495 },
  addOns: [], subtotal: 5495, tax: 453.34, total: 5948.34, deposit: 594.83,
  paymentMethod: 'full', financing: null, currency: 'USD', priceLockDays: 7,
};

test('createLock → verifyLock roundtrip preserves ref and quote', () => {
  const { token, ref, expiresAt } = createLock(QUOTE, { email: 'a@b.c', name: 'A' });
  assert.match(ref, /^AQ-[A-Z2-9]{8}$/);
  assert.ok(new Date(expiresAt).getTime() > Date.now());
  const payload = verifyLock(token);
  assert.equal(payload.ref, ref);
  assert.equal(payload.quote.total, QUOTE.total);
  assert.equal(payload.typ, 'price_lock');
});

test('tampered payload segment is rejected (price tampering)', () => {
  const { token } = createLock(QUOTE, { email: 'a@b.c' });
  const [h, p, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), quote: { ...QUOTE, total: 1 } })).toString('base64url');
  assert.throws(() => verifyLock([h, forged, s].join('.')), (e) => e.status === 401 && e.code === 'LOCK_INVALID');
});

test('tampered signature is rejected', () => {
  const { token } = createLock(QUOTE, { email: 'a@b.c' });
  const parts = token.split('.');
  parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('A') ? 'B' : 'A');
  assert.throws(() => verifyLock(parts.join('.')), (e) => e.code === 'LOCK_INVALID');
});

test('token signed with a different secret is rejected', () => {
  const bad = jwt.sign({ v: 1, typ: 'price_lock', ref: 'AQ-XXXXXXXX', quote: QUOTE }, 'not-the-secret', { expiresIn: '7d' });
  assert.throws(() => verifyLock(bad), (e) => e.code === 'LOCK_INVALID');
});

test('a session-shaped token (wrong typ) is rejected as a lock', () => {
  const bad = jwt.sign({ sub: 'usr_1', role: 'admin' }, process.env.LOCK_SECRET, { expiresIn: '1h' });
  assert.throws(() => verifyLock(bad), (e) => e.code === 'LOCK_INVALID');
});

test('expired lock returns 410 LOCK_EXPIRED', () => {
  const expired = jwt.sign({ v: 1, typ: 'price_lock', ref: 'AQ-XXXXXXXX', quote: QUOTE }, process.env.LOCK_SECRET, { expiresIn: '-5s' });
  assert.throws(() => verifyLock(expired), (e) => e.status === 410 && e.code === 'LOCK_EXPIRED');
});

test('garbage input is rejected', () => {
  assert.throws(() => verifyLock('not-a-jwt'), (e) => e.code === 'LOCK_INVALID');
  assert.throws(() => verifyLock(''), (e) => e.code === 'LOCK_INVALID');
  assert.throws(() => verifyLock(null), (e) => e.code === 'LOCK_INVALID');
});
