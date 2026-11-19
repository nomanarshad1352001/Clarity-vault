'use strict';
/**
 * API integration tests — boots the real Express app on an ephemeral port and
 * exercises auth, CSRF, validation, pricing, price locks, deposits, roles and
 * rate limiting. Runs entirely in mock-adapter mode.
 */
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.LOCK_SECRET = 'test-lock-secret';
process.env.CSRF_SECRET = 'test-csrf-secret';
process.env.RATE_LIMIT_LOGIN_MAX = '50';

const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server/app');
const store = require('../server/services/store');
const { createRateLimiter } = require('../server/middleware/rateLimit');

let base;
let srv;

function cookieOf(res) {
  const set = res.headers.get('set-cookie') || '';
  const m = set.match(/ad_session=[^;]+/);
  return m ? m[0] : null;
}

async function req(path, { method = 'GET', body, cookie, csrf, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...headers,
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* csv etc. */ }
  return { status: res.status, json, res };
}

async function login(email, password = 'Demo@123') {
  const r = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  return { ...r, cookie: cookieOf(r.res), csrf: r.json && r.json.csrfToken };
}

const QUOTE = {
  budget: { type: 'monthly', amount: 200 },
  address: '100 Maple Ave',
  zip: '75201',
  homeSqft: 2000,
  systemId: 'goodman-good',
  tonnageTons: 2.5,
  addOnIds: ['smart-thermostat'],
  paymentMethod: 'full',
  termMonths: null,
};

test.before(async () => {
  store._resetForTests();
  srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.after(() => {
  if (srv) { srv.closeAllConnections?.(); srv.close(); }
});

test('GET /api/health → 200 with adapter modes', async () => {
  const r = await req('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'ok');
  assert.equal(r.json.adapters.payments, 'mock');
});

test('GET /api/catalog → 9 systems, 8 add-ons, public pricing facts', async () => {
  const r = await req('/api/catalog');
  assert.equal(r.status, 200);
  assert.equal(r.json.systems.length, 9);
  assert.equal(r.json.addOns.length, 8);
  assert.equal(r.json.pricing.depositPercent, 0.1);
});

test('login: wrong password → 401, correct → httpOnly cookie + csrf + redirect', async () => {
  const bad = await login('homeowner@demo.com', 'wrong');
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error.code, 'INVALID_CREDENTIALS');

  const ok = await login('homeowner@demo.com');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, 'homeowner');
  assert.equal(ok.json.redirect, '/quote');
  assert.match(ok.res.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(ok.res.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.ok(ok.csrf && ok.csrf.length > 20);

  const me = await req('/api/auth/me', { cookie: ok.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'homeowner@demo.com');
});

test('tampered session cookie → 401 on /me', async () => {
  const ok = await login('homeowner@demo.com');
  const forged = ok.cookie.replace(/ad_session=(.+)\.(.+)\./, 'ad_session=$1.AAAA.');
  const me = await req('/api/auth/me', { cookie: forged });
  assert.equal(me.status, 401);
});

test('quote: unauthenticated → 401; missing CSRF → 403; valid → 200', async () => {
  const unauth = await req('/api/quote', { method: 'POST', body: QUOTE });
  assert.equal(unauth.status, 401);

  const { cookie, csrf } = await login('homeowner@demo.com');
  const noCsrf = await req('/api/quote', { method: 'POST', body: QUOTE, cookie });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.json.error.code, 'CSRF_FAILED');

  const badCsrf = await req('/api/quote', { method: 'POST', body: QUOTE, cookie, csrf: 'deadbeef'.repeat(8) });
  assert.equal(badCsrf.status, 403);

  const ok = await req('/api/quote', { method: 'POST', body: QUOTE, cookie, csrf });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.quote.subtotal, 5495 + 349);
  assert.equal(ok.json.quote.tax, 482.13); // 5844 × 8.25%
  assert.equal(ok.json.quote.total, 6326.13);
  assert.equal(ok.json.quote.deposit, 632.61);
});

test('quote: server-side validation of ids, zip, and shapes', async () => {
  const { cookie, csrf } = await login('homeowner@demo.com');
  const post = (body) => req('/api/quote', { method: 'POST', body, cookie, csrf });

  assert.equal((await post({ ...QUOTE, systemId: 'acme-9000' })).status, 422);
  assert.equal((await post({ ...BASE, addOnIds: ['not-real'] })).status, 422);
  assert.equal((await post({ ...QUOTE, zip: '90210' })).json.error.code, 'OUTSIDE_SERVICE_AREA');
  assert.equal((await post({ ...QUOTE, zip: '7520' })).status, 400);
  assert.equal((await post({ ...QUOTE, homeSqft: 50 })).status, 400);
  assert.equal((await post({ ...QUOTE, addOnIds: 'smart-thermostat' })).status, 400);
});

test('full flow: lock → verify → deposit → idempotent replay → sales sees it', async () => {
  const home = await login('homeowner@demo.com');
  const lock = await req('/api/quote/lock', { method: 'POST', body: QUOTE, cookie: home.cookie, csrf: home.csrf });
  assert.equal(lock.status, 201);
  const { token, ref } = lock.json;
  assert.match(ref, /^AQ-/);

  const verify = await req(`/api/quote/verify?token=${encodeURIComponent(token)}`);
  assert.equal(verify.status, 200);
  assert.equal(verify.json.ref, ref);

  // tampered token rejected
  const forged = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  const badVerify = await req(`/api/quote/verify?token=${encodeURIComponent(forged)}`);
  assert.equal(badVerify.status, 401);

  // deposit — amount comes from the token, not the client
  const pay = await req('/api/payments/deposit', {
    method: 'POST',
    body: { lockToken: token, card: { name: 'Harper H', number: '4242 4242 4242 4242', exp: '12/28', cvc: '123' } },
    cookie: home.cookie, csrf: home.csrf,
  });
  assert.equal(pay.status, 200);
  assert.equal(pay.json.status, 'succeeded');
  assert.equal(pay.json.deposit, lock.json.quote.deposit);

  const replay = await req('/api/payments/deposit', {
    method: 'POST',
    body: { lockToken: token, card: { name: 'Harper H', number: '4242 4242 4242 4242', exp: '12/28', cvc: '123' } },
    cookie: home.cookie, csrf: home.csrf,
  });
  assert.equal(replay.json.status, 'already_paid');

  // sales role can list + detail
  const sales = await login('sales@demo.com');
  assert.equal(sales.json.redirect, '/sales');
  const list = await req('/api/orders', { cookie: sales.cookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.orders.some((o) => o.ref === ref && o.status === 'paid'));
  const detail = await req(`/api/orders/${list.json.orders.find((o) => o.ref === ref).id}`, { cookie: sales.cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.order.quote.total, lock.json.quote.total);

  // csv export works for sales
  const csv = await fetch(`${base}/api/orders/export.csv`, { headers: { cookie: sales.cookie } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), new RegExp(ref));
});

test('declined test card → 402 and order stays locked', async () => {
  const home = await login('homeowner@demo.com');
  const lock = await req('/api/quote/lock', { method: 'POST', body: QUOTE, cookie: home.cookie, csrf: home.csrf });
  const pay = await req('/api/payments/deposit', {
    method: 'POST',
    body: { lockToken: lock.json.token, card: { name: 'H', number: '4000 0000 0000 0002', exp: '12/28', cvc: '123' } },
    cookie: home.cookie, csrf: home.csrf,
  });
  assert.equal(pay.status, 402);
  const order = store.getOrderByRef(lock.json.ref);
  assert.equal(order.status, 'locked');
});

test('roles: homeowner cannot read sales/admin routes; admin can', async () => {
  const home = await login('homeowner@demo.com');
  assert.equal((await req('/api/orders', { cookie: home.cookie })).status, 403);
  assert.equal((await req('/api/admin/audit', { cookie: home.cookie })).status, 403);

  const admin = await login('admin@demo.com');
  assert.equal(admin.json.redirect, '/admin');
  assert.equal((await req('/api/admin/audit', { cookie: admin.cookie })).status, 200);
  const integ = await req('/api/admin/integrations', { cookie: admin.cookie });
  assert.equal(integ.status, 200);
  assert.equal(integ.json.integrations.length, 6);

  // live toggle without keys → 422
  const tog = await req('/api/admin/integrations', { method: 'POST', body: { domain: 'payments', mode: 'live' }, cookie: admin.cookie, csrf: admin.csrf });
  assert.equal(tog.status, 422);
  assert.ok(tog.json.error.details.missing.includes('STRIPE_SECRET_KEY'));

  // audit captured admin + payment activity
  const audit = await req('/api/admin/audit', { cookie: admin.cookie });
  const types = audit.json.entries.map((e) => e.type);
  assert.ok(types.includes('PRICE_LOCKED'));
  assert.ok(types.includes('PAYMENT_SUCCEEDED'));
});

test('admin pricing-rules validation rejects nonsense', async () => {
  const admin = await login('admin@demo.com');
  const current = await req('/api/admin/pricing-rules', { cookie: admin.cookie });
  const bad = { ...current.json.pricingRules, taxRate: 99 };
  delete bad._comment;
  const r = await req('/api/admin/pricing-rules', { method: 'PUT', body: bad, cookie: admin.cookie, csrf: admin.csrf });
  assert.equal(r.status, 400);
});

test('financing prequalify: decline when payment exceeds budget', async () => {
  const home = await login('homeowner@demo.com');
  const quote = { ...QUOTE, paymentMethod: 'financing', termMonths: 60 };
  const declined = await req('/api/financing/prequalify', { method: 'POST', body: { quote, statedMonthlyBudget: 40 }, cookie: home.cookie, csrf: home.csrf });
  assert.equal(declined.json.result.status, 'declined');
  const approved = await req('/api/financing/prequalify', { method: 'POST', body: { quote, statedMonthlyBudget: 500 }, cookie: home.cookie, csrf: home.csrf });
  assert.equal(approved.json.result.status, 'approved');
});

test('address: mock autocomplete + service-area check', async () => {
  const sug = await req('/api/address/suggest?q=maple');
  assert.equal(sug.status, 200);
  assert.ok(sug.json.suggestions.length > 0);
  const inArea = await req('/api/address/check', { method: 'POST', body: { zip: '75201' } });
  assert.equal(inArea.json.serviceable, true);
  const out = await req('/api/address/check', { method: 'POST', body: { zip: '90210' } });
  assert.equal(out.json.serviceable, false);
  const bad = await req('/api/address/check', { method: 'POST', body: { zip: 'abcde' } });
  assert.equal(bad.status, 400);
});

test('bad JSON body → 400 BAD_JSON', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: '{nope', raw: true, headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'BAD_JSON');
});

test('rate limiter blocks brute force after the limit', async () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 3, name: 'test-bruteforce' });
  const fakeReq = () => ({ ip: '9.9.9.9' });
  const run = () => new Promise((resolve) => limiter(fakeReq(), {}, resolve));
  for (let i = 0; i < 3; i += 1) assert.equal(await run(), undefined);
  const err = await run();
  assert.equal(err.status, 429);
  assert.equal(err.code, 'RATE_LIMITED');
});

test('logger redacts personal data and JWT-shaped strings', async () => {
  const logger = require('../server/logger');
  const out = logger.redact({ email: 'a@b.c', card: '4242', nested: { password: 'x', note: 'ok' } });
  assert.equal(out.email, '[redacted]');
  assert.equal(out.card, '[redacted]');
  assert.equal(out.nested.password, '[redacted]');
  assert.equal(out.nested.note, 'ok');
  const jwtish = logger.redact('tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c end');
  assert.match(jwtish, /\[redacted-jwt\]/);
});

const BASE = QUOTE;
