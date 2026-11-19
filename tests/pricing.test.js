'use strict';
/**
 * Unit tests for the server-side pricing engine.
 * All expectations derive from config/pricing-rules.json + config/catalog.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const pricing = require('../server/services/pricing');

const BASE = {
  address: '100 Maple Ave',
  zip: '75201', // inside service area
  homeSqft: 2000, // multiplier 1.0
  systemId: 'goodman-good', // base 5495
  tonnageTons: 2.5, // delta 0
  addOnIds: [],
  paymentMethod: 'full',
  termMonths: null,
  budget: null,
};

test('base quote: subtotal, tax (8.25%), total, 10% deposit', () => {
  const q = pricing.computeQuote({ ...BASE });
  assert.equal(q.system.price, 5495);
  assert.equal(q.subtotal, 5495);
  assert.equal(q.tax, 453.34); // 5495 * 0.0825 = 453.3375
  assert.equal(q.total, 5948.34);
  assert.equal(q.deposit, 594.83); // 10%
});

test('add-ons are summed into subtotal before tax', () => {
  const q = pricing.computeQuote({ ...BASE, addOnIds: ['smart-thermostat', 'new-pad'] });
  assert.equal(q.addOnsTotal, 349 + 225);
  assert.equal(q.subtotal, 5495 + 574);
  assert.equal(q.total, pricing.round2((5495 + 574) * 1.0825));
});

test('duplicate add-on ids are deduplicated', () => {
  const q = pricing.computeQuote({ ...BASE, addOnIds: ['new-pad', 'new-pad', 'new-pad'] });
  assert.equal(q.addOnsTotal, 225);
});

test('home-size multiplier applies (4500 sqft → 1.22×)', () => {
  const q = pricing.computeQuote({ ...BASE, homeSqft: 4500 });
  assert.equal(q.system.price, pricing.round2(5495 * 1.22));
});

test('tonnage delta applies (5 tons → +$1500)', () => {
  const q = pricing.computeQuote({ ...BASE, tonnageTons: 5 });
  assert.equal(q.system.price, 5495 + 1500);
});

test('unknown system id is rejected', () => {
  assert.throws(() => pricing.computeQuote({ ...BASE, systemId: 'acme-9000' }), /Unknown system/);
});

test('unknown add-on id is rejected', () => {
  assert.throws(() => pricing.computeQuote({ ...BASE, addOnIds: ['gold-plated-ducts'] }), /Unknown add-on/);
});

test('tonnage not offered by the system is rejected', () => {
  assert.throws(() => pricing.computeQuote({ ...BASE, systemId: 'goodman-best', tonnageTons: 1.5 }), /tonnage/i);
});

test('zip outside the service area is rejected', () => {
  assert.throws(() => pricing.computeQuote({ ...BASE, zip: '90210' }), /not serving|not in|service/i);
});

test('invalid financing term is rejected', () => {
  assert.throws(
    () => pricing.computeQuote({ ...BASE, paymentMethod: 'financing', termMonths: 48 }),
    /term/i
  );
});

test('financing: 12-month 0% APR is straight division of principal', () => {
  const q = pricing.computeQuote({ ...BASE, paymentMethod: 'financing', termMonths: 12 });
  const principal = pricing.round2(q.total - q.deposit);
  assert.equal(q.financing.principal, principal);
  assert.equal(q.financing.monthlyPayment, pricing.round2(principal / 12));
  assert.ok(Math.abs(q.financing.totalInterest) <= 0.12, '0% APR should have ~zero interest (± monthly cent rounding)');
});

test('financing: 60-month amortization matches the standard formula', () => {
  const q = pricing.computeQuote({ ...BASE, paymentMethod: 'financing', termMonths: 60 });
  const r = 0.1099 / 12;
  const expected = pricing.round2((q.financing.principal * r) / (1 - Math.pow(1 + r, -60)));
  assert.equal(q.financing.monthlyPayment, expected);
  assert.ok(q.financing.totalInterest > 0, 'interest should be positive at 10.99% APR');
  assert.ok(
    Math.abs(q.financing.totalOfPayments - (q.financing.monthlyPayment * 60 + q.deposit)) < 0.02,
    'total of payments = monthly × months + deposit'
  );
});

test('budget fit classification', () => {
  const within = pricing.computeQuote({ ...BASE, budget: { type: 'total', amount: 10000 } });
  const over = pricing.computeQuote({ ...BASE, systemId: 'trane-best', budget: { type: 'total', amount: 5000 } });
  assert.equal(within.budgetFit, 'within');
  assert.equal(over.budgetFit, 'over');
});
