'use strict';
const { start, client, goodQuote } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const pricing = require('../server/services/pricing');
const tokens = require('../server/services/tokens');
const configStore = require('../server/services/configStore');
const config = require('../server/config');

const ctx = configStore.getContext();
const base = { budget: 9000, budgetType: 'total', address: '1 A St', zip: '78701', systemId: 'goodman-good', addOnIds: [], paymentMethod: 'full' };

test('amortization matches the standard formula', () => {
  // $10,000 @ 12% APR over 12 months => $888.49/month
  assert.equal(pricing.monthlyPaymentCents(1_000_000, 12, 12), 88849);
  assert.equal(pricing.monthlyPaymentCents(120_000, 0, 12), 10_000); // 0% APR
  assert.equal(pricing.monthlyPaymentCents(0, 9, 36), 0);
});

test('quote totals: base + adjustments + add-ons, tax, deposit, balance', () => {
  const q = pricing.calculateQuote({ ...base, addOnIds: ['smart-thermostat', 'new-pad'] }, ctx);
  const expectedSubtotal = q.items.reduce((s, i) => s + i.amountCents, 0);
  assert.equal(q.subtotalCents, expectedSubtotal);
  assert.equal(q.taxCents, Math.round((expectedSubtotal * ctx.rules.taxRatePercent) / 100));
  assert.equal(q.totalCents, q.subtotalCents + q.taxCents);
  assert.equal(q.depositCents, Math.round((q.totalCents * ctx.rules.depositPercent) / 100));
  assert.equal(q.balanceCents, q.totalCents - q.depositCents);
  assert.equal(q.addOnsCents, 28900 + 39500);
  assert.equal(q.financingOptions.length, ctx.rules.financingTerms.length);
});

test('financing payment is computed from the balance and the term APR', () => {
  const q = pricing.calculateQuote({ ...base, paymentMethod: 'financing', termMonths: 36 }, ctx);
  const apr = ctx.rules.financingTerms.find((t) => t.months === 36).aprPercent;
  assert.equal(q.financing.monthlyPaymentCents, pricing.monthlyPaymentCents(q.balanceCents, apr, 36));
});

test('wrong IDs and bad business input are rejected by the pricing engine', () => {
  assert.throws(() => pricing.calculateQuote({ ...base, systemId: 'nope' }, ctx), { code: 'unknown_system' });
  assert.throws(() => pricing.calculateQuote({ ...base, addOnIds: ['nope'] }, ctx), { code: 'unknown_addon' });
  assert.throws(() => pricing.calculateQuote({ ...base, addOnIds: ['new-pad', 'new-pad'] }, ctx), { code: 'unknown_addon' });
  assert.throws(() => pricing.calculateQuote({ ...base, zip: '90210' }, ctx), { code: 'outside_service_area' });
  assert.throws(() => pricing.calculateQuote({ ...base, tonnage: 9 }, ctx), { code: 'bad_tonnage' });
  assert.throws(() => pricing.calculateQuote({ ...base, paymentMethod: 'financing', termMonths: 7 }, ctx), { code: 'bad_term' });
});

// ---------------------------------------------------------------- tokens
const payload = () => ({ ref: 'AC-ABCDEFGH', quote: pricing.calculateQuote(base, ctx), financing: null });

test('valid lock token round-trips', () => {
  const t = tokens.signLock(payload(), { expiresInSec: 60 });
  const p = tokens.verifyLock(t);
  assert.equal(p.ref, 'AC-ABCDEFGH');
  assert.ok(p.exp - p.iat === 60);
});

test('tampered token is rejected', () => {
  const t = tokens.signLock(payload(), { expiresInSec: 60 });
  const [h, b, s] = t.split('.');
  const body = JSON.parse(Buffer.from(b, 'base64url').toString());
  body.quote.totalCents = 1; // attacker lowers the price
  const forged = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`;
  assert.throws(() => tokens.verifyLock(forged), { code: 'invalid' });
  assert.throws(() => tokens.verifyLock(`${t}x`), { code: 'invalid' });
});

test('token signed with the wrong secret, "none" algorithm, or wrong audience is rejected', () => {
  const p = payload();
  const wrongSecret = jwt.sign(p, 'another-secret-another-secret-another-secret', { audience: 'price-lock', issuer: 'ac-quote', jwtid: p.ref, expiresIn: 60 });
  assert.throws(() => tokens.verifyLock(wrongSecret), { code: 'invalid' });
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...p, jti: p.ref, aud: 'price-lock', iss: 'ac-quote', exp: 9999999999 })).toString('base64url')}.`;
  assert.throws(() => tokens.verifyLock(none), { code: 'invalid' });
  const wrongAud = jwt.sign(p, config.secrets.lock, { audience: 'session', issuer: 'ac-quote', jwtid: p.ref, expiresIn: 60 });
  assert.throws(() => tokens.verifyLock(wrongAud), { code: 'invalid' });
});

test('expired token is rejected', () => {
  const t = tokens.signLock(payload(), { expiresInSec: -10 });
  assert.throws(() => tokens.verifyLock(t), { code: 'expired' });
});

test('token with a mismatched ref/jti or malformed ref is rejected', () => {
  const p = payload();
  const bad = jwt.sign({ ...p, ref: 'AC-12345678' }, config.secrets.lock, { audience: 'price-lock', issuer: 'ac-quote', jwtid: 'AC-ABCDEFGH', expiresIn: 60 });
  assert.throws(() => tokens.verifyLock(bad), { code: 'invalid' });
  const bad2 = jwt.sign({ ...p, ref: 'nope' }, config.secrets.lock, { audience: 'price-lock', issuer: 'ac-quote', jwtid: 'nope', expiresIn: 60 });
  assert.throws(() => tokens.verifyLock(bad2), { code: 'invalid' });
});

// ---------------------------------------------------------------- HTTP
test('POST /api/quote returns server-calculated prices and rejects client-supplied prices', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const ok = await c.post('/api/quote', goodQuote());
    assert.equal(ok.status, 200);
    assert.ok(ok.body.quote.totalCents > 0);
    for (const extra of [{ totalCents: 1 }, { price: 1 }, { depositCents: 1 }, { basePrice: 1 }]) {
      const r = await c.post('/api/quote', { ...goodQuote(), ...extra });
      assert.equal(r.status, 400, `extra field ${Object.keys(extra)} must be rejected`);
    }
    assert.equal((await c.post('/api/quote', goodQuote({ systemId: 'bogus' }))).status, 422);
    assert.equal((await c.post('/api/quote', goodQuote({ addOnIds: ['bogus'] }))).status, 422);
    assert.equal((await c.post('/api/quote', goodQuote({ zip: '10001' }))).body.error, 'outside_service_area');
    assert.equal((await c.post('/api/quote', goodQuote({ paymentMethod: 'financing' }))).status, 400); // term required
  } finally { await srv.close(); }
});
