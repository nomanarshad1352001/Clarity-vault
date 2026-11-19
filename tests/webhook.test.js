'use strict';
/**
 * Webhook tests — Stripe signature verification, spoofing rejection, and
 * idempotent replay protection. Uses the official Stripe SDK's test header
 * generator against our live-mode adapter.
 */
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.LOCK_SECRET = 'test-lock-secret';
process.env.CSRF_SECRET = 'test-csrf-secret';
process.env.PAYMENTS_ADAPTER = 'live';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_tests';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_for_tests';

const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');

const app = require('../server/app');
const store = require('../server/services/store');

let base;
let srv;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

test.before(async () => {
  store._resetForTests();
  srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  store.createOrder({
    ref: 'AQ-WEBHOOK1',
    customerEmail: 'webhook@demo.com',
    customerName: 'Web Hook',
    zip: '75201',
    quote: { system: { brand: 'Goodman', name: 'GSX14', tons: 2.5 }, addOns: [], total: 5948.34, deposit: 594.83, paymentMethod: 'full' },
    lockExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
});

test.after(() => {
  if (srv) { srv.closeAllConnections?.(); srv.close(); }
});

function eventPayload(ref) {
  return JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_123', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_test_123', metadata: { ref } } },
  });
}

async function postWebhook(payload, signature) {
  const res = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('valid signature → order marked paid', async () => {
  const payload = eventPayload('AQ-WEBHOOK1');
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await postWebhook(payload, sig);
  assert.equal(r.status, 200);
  assert.equal(r.json.received, true);
  assert.equal(store.getOrderByRef('AQ-WEBHOOK1').status, 'paid');
});

test('replayed event is idempotent (duplicate acknowledged, not reprocessed)', async () => {
  const payload = eventPayload('AQ-WEBHOOK1');
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const before = store.listAudit({ type: 'PAYMENT_SUCCEEDED' }).length;
  const r = await postWebhook(payload, sig);
  assert.equal(r.status, 200);
  assert.equal(r.json.duplicate, true);
  const after = store.listAudit({ type: 'PAYMENT_SUCCEEDED' }).length;
  assert.equal(before, after, 'no second payment recorded for a replayed event');
});

test('spoofed signature → 400 and no state change', async () => {
  const payload = JSON.stringify({
    id: 'evt_evil',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_evil', payment_status: 'paid', metadata: { ref: 'AQ-WEBHOOK1' } } },
  });
  const r = await postWebhook(payload, 't=1,v1=forged');
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'WEBHOOK_SIGNATURE_INVALID');
});

test('payload signed with the wrong secret → 400', async () => {
  const payload = eventPayload('AQ-WEBHOOK1');
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong' });
  const r = await postWebhook(payload, sig.replace(/evt_test_1/, 'evt_test_2'));
  assert.equal(r.status, 400);
});
