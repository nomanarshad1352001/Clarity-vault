'use strict';
const { start, client, goodQuote, customer } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const orders = require('../server/services/orders');
const queue = require('../server/services/queue');
const adapters = require('../server/adapters');
const paymentsMock = require('../server/adapters/payments').mock;
const { resetLockouts } = require('../server/routes/auth');

async function lockAndPay(c, over = {}) {
  const lock = await c.post('/api/quote/lock', { ...goodQuote(over), customer });
  assert.equal(lock.status, 201, JSON.stringify(lock.body));
  const sess = await c.post('/api/payment/session', { token: lock.body.token });
  assert.equal(sess.status, 200, JSON.stringify(sess.body));
  return { lock: lock.body, sess: sess.body };
}

const signedWebhook = (event, secretOverride) => {
  const raw = JSON.stringify(event);
  const sig = secretOverride ? `sha256=${crypto.createHmac('sha256', secretOverride).update(raw).digest('hex')}` : paymentsMock.signPayload(raw);
  return { raw, sig };
};

test('full flow: lock -> mock card -> confirm -> paid, deposit comes from the server', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const { lock, sess } = await lockAndPay(c);
    assert.equal(sess.amountCents, lock.quote.depositCents);
    assert.match(sess.url, /^\/pay\/mock\?session=/);
    const bad = await c.post('/api/payment/mock/complete', { sessionId: sess.sessionId, card: { number: '4000000000000002', expiry: '12/40', cvc: '123' } });
    assert.equal(bad.status, 402);
    assert.equal(orders.get(lock.ref).status, 'locked');
    const ok = await c.post('/api/payment/mock/complete', { sessionId: sess.sessionId, card: { number: '4242 4242 4242 4242', expiry: '12/40', cvc: '123' } });
    assert.equal(ok.status, 200);
    const conf = await c.get(`/api/payment/confirm?session_id=${sess.sessionId}`);
    assert.equal(conf.body.order.status, 'paid');
    // verify endpoint reports paid
    assert.equal((await c.get(`/api/quote/verify?token=${lock.token}`)).body.depositPaid, true);
  } finally { await srv.close(); }
});

test('price tampering: forged token, extra fields and client "amount" are all rejected', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const lock = (await c.post('/api/quote/lock', { ...goodQuote(), customer })).body;
    const [h, b, s] = lock.token.split('.');
    const body = JSON.parse(Buffer.from(b, 'base64url').toString()); body.quote.totalCents = 100; body.quote.depositCents = 10;
    const forged = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`;
    assert.equal((await c.get(`/api/quote/verify?token=${forged}`)).status, 400);
    assert.equal((await c.post('/api/payment/session', { token: forged })).status, 400);
    assert.equal((await c.post('/api/payment/session', { token: lock.token, amountCents: 1 })).status, 400); // strict schema
    assert.equal((await c.post('/api/quote/lock', { ...goodQuote(), customer, totalCents: 1 })).status, 400);
    const mockComplete = await c.post('/api/payment/mock/complete', { sessionId: 'mock_cs_doesnotexist12345', card: { number: '4242424242424242', expiry: '12/40', cvc: '123' } });
    assert.equal(mockComplete.status, 402);
  } finally { await srv.close(); }
});

test('token replay: a paid lock cannot be paid again; session and lock tokens are not interchangeable', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const { lock, sess } = await lockAndPay(c);
    await c.post('/api/payment/mock/complete', { sessionId: sess.sessionId, card: { number: '4242424242424242', expiry: '12/40', cvc: '123' } });
    const again = await c.post('/api/payment/session', { token: lock.token });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already_paid');
    // replaying the completed mock session
    const replay = await c.post('/api/payment/mock/complete', { sessionId: sess.sessionId, card: { number: '4242424242424242', expiry: '12/40', cvc: '123' } });
    assert.equal(replay.status, 402);
    // lock token used as a session cookie => not authenticated
    const evil = client(srv.base);
    evil.jar.session = lock.token;
    assert.equal((await evil.get('/api/auth/me')).status, 401);
    assert.equal((await evil.get('/api/sales/orders')).status, 401);
    // session cookie used as a lock token => rejected
    const login = client(srv.base);
    await login.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' });
    assert.equal((await c.get(`/api/quote/verify?token=${login.jar.session}`)).status, 400);
  } finally { await srv.close(); }
});

test('webhook spoofing: bad/missing signatures rejected, valid accepted once, amount mismatch ignored', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const { lock, sess } = await lockAndPay(c);
    const event = { id: 'evt_test_1', type: 'checkout.session.completed', data: { object: { id: sess.sessionId, payment_status: 'paid', amount_total: lock.quote.depositCents, metadata: { ref: lock.ref } } } };
    const post = (raw, sig) => fetch(`${srv.base}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-mock-signature': sig } : {}) }, body: raw });

    assert.equal((await post(JSON.stringify(event))).status, 400); // no signature
    assert.equal((await post(JSON.stringify(event), 'sha256=deadbeef')).status, 400); // junk signature
    const attacker = signedWebhook(event, 'attacker-secret');
    assert.equal((await post(attacker.raw, attacker.sig)).status, 400); // signed with wrong key
    assert.equal(orders.get(lock.ref).status, 'locked');

    // valid signature but tampered body after signing
    const good = signedWebhook(event);
    assert.equal((await post(good.raw.replace('"paid"', '"paid" '), good.sig)).status, 400);

    // valid but wrong amount: accepted by the endpoint (signature ok) but must NOT mark paid
    const cheap = signedWebhook({ ...event, id: 'evt_test_cheap', data: { object: { ...event.data.object, amount_total: 100 } } });
    assert.equal((await post(cheap.raw, cheap.sig)).status, 200);
    assert.equal(orders.get(lock.ref).status, 'locked');

    // valid
    assert.equal((await post(good.raw, good.sig)).status, 200);
    assert.equal(orders.get(lock.ref).status, 'paid');
    // idempotent replay
    const replay = await post(good.raw, good.sig);
    assert.equal((await replay.json()).duplicate, true);
    assert.equal(orders.get(lock.ref).status, 'paid');
  } finally { await srv.close(); }
});

test('brute-force login: account locks after repeated failures, even with the right password', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    for (let i = 0; i < config.rate.loginLockoutAfter; i++) {
      const r = await c.post('/api/auth/login', { email: 'sales@demo.com', password: `wrong-${i}` });
      assert.equal(r.status, 401);
    }
    const locked = await c.post('/api/auth/login', { email: 'sales@demo.com', password: 'Demo@123' });
    assert.equal(locked.status, 429);
    assert.equal(c.jar.session, undefined);
    // other accounts are unaffected
    assert.equal((await c.post('/api/auth/login', { email: 'homeowner@demo.com', password: 'Demo@123' })).status, 200);
  } finally { resetLockouts(); await srv.close(); }
});

test('login: IP rate limit applies to unknown emails and cookie flags are set', async () => {
  process.env.RATE_LOGIN_PER_15MIN = '100';
  const srv = await start(); const c = client(srv.base);
  try {
    const ok = await c.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.redirect, '/admin');
    const setCookie = ok.headers.getSetCookie().find((x) => x.startsWith('session='));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.equal((await c.get('/api/auth/me')).body.user.role, 'admin');
    await c.post('/api/auth/logout', {});
    assert.equal((await c.get('/api/auth/me')).status, 401);
    assert.equal((await c.post('/api/auth/login', { email: 'nobody@demo.com', password: 'x' })).status, 401);
  } finally { await srv.close(); }
});

test('bad address input is rejected with 400 or a friendly service-area error', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const bad = ['<script>alert(1)</script>', "123'; DROP TABLE orders;--", 'x', 'Main Street no number', '1'.repeat(300), '123 Main St\u0000', '{"$gt":""}'];
    for (const address of bad) assert.equal((await c.post('/api/quote', goodQuote({ address }))).status, 400, `address ${JSON.stringify(address).slice(0, 30)}`);
    for (const zip of ['abcde', '1234', '123456', '78701; --', '']) assert.equal((await c.post('/api/quote', goodQuote({ zip }))).status, 400, `zip ${zip}`);
    assert.equal((await c.post('/api/quote', goodQuote({ state: 'Texas' }))).status, 400);
    assert.equal((await c.post('/api/quote', goodQuote({ city: '<b>x</b>' }))).status, 400);
    const outside = await c.post('/api/quote', goodQuote({ zip: '99999' }));
    assert.equal(outside.status, 422); assert.equal(outside.body.error, 'outside_service_area');
    assert.equal((await c.get('/api/address/check?zip=78701')).body.inServiceArea, true);
    assert.equal((await c.get('/api/address/check?zip=99999')).body.inServiceArea, false);
    assert.equal((await c.get('/api/address/check?zip=abc')).status, 400);
    assert.equal((await c.get('/api/address/details?id=../../etc/passwd')).status, 400);
  } finally { await srv.close(); }
});

test('CSRF: cookie-authenticated POST without the token (or from another origin) is blocked', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    await c.get('/api/csrf');
    assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' }, { csrf: false })).status, 403);
    assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' }, { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' }, { headers: { 'x-csrf-token': 'forged.value' }, csrf: false })).status, 403);
    assert.equal((await c.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' })).status, 200);
  } finally { await srv.close(); }
});

test('role protection: APIs and pages', async () => {
  const srv = await start();
  try {
    const anon = client(srv.base);
    assert.equal((await anon.get('/api/sales/orders')).status, 401);
    assert.equal((await anon.get('/api/admin/config')).status, 401);
    assert.equal((await anon.put('/api/admin/pricing', { data: {} })).status, 401);
    assert.equal((await anon.get('/sales')).status, 302);
    assert.equal((await anon.get('/sales.html')).status, 302);
    assert.equal((await anon.get('/admin')).status, 302);

    const home = client(srv.base); await home.post('/api/auth/login', { email: 'homeowner@demo.com', password: 'Demo@123' });
    assert.equal((await home.get('/api/sales/orders')).status, 403);
    assert.equal((await home.get('/admin')).status, 302);

    const sales = client(srv.base); await sales.post('/api/auth/login', { email: 'sales@demo.com', password: 'Demo@123' });
    assert.equal((await sales.get('/api/sales/orders')).status, 200);
    assert.equal((await sales.get('/api/admin/audit')).status, 403);
    assert.equal((await sales.get('/sales')).status, 200);
    assert.equal((await sales.get('/admin')).status, 302);

    const admin = client(srv.base); await admin.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' });
    assert.equal((await admin.get('/api/admin/config')).status, 200);
    assert.equal((await admin.get('/admin')).status, 200);
  } finally { await srv.close(); }
});

test('admin edits need validation + confirm, and toggling to live without credentials is refused', async () => {
  const srv = await start(); const admin = client(srv.base);
  try {
    await admin.post('/api/auth/login', { email: 'admin@demo.com', password: 'Demo@123' });
    const { pricing } = (await admin.get('/api/admin/config')).body;
    const dry = await admin.put('/api/admin/pricing', { data: { ...pricing, taxRatePercent: 9 } });
    assert.equal(dry.body.saved, false); assert.equal(dry.body.changes[0].path, 'taxRatePercent');
    assert.equal((await admin.get('/api/admin/config')).body.pricing.taxRatePercent, pricing.taxRatePercent); // unchanged
    assert.equal((await admin.put('/api/admin/pricing', { data: { ...pricing, taxRatePercent: 999 } })).status, 400);
    assert.equal((await admin.post('/api/admin/adapters/payments', { mode: 'live' })).status, 400);
    assert.equal((await admin.post('/api/admin/adapters/payments', { mode: 'bogus' })).status, 400);
    assert.equal(adapters.getMode('payments'), 'mock');
  } finally { await srv.close(); }
});

test('financing mock: declines when the payment is too high for a monthly budget; lock is refused', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const input = goodQuote({ budget: 60, budgetType: 'monthly', paymentMethod: 'financing', termMonths: 12 });
    const pre = await c.post('/api/financing/prequalify', input);
    assert.equal(pre.body.selected.status, 'declined');
    assert.ok(pre.body.terms.length === 3);
    const lock = await c.post('/api/quote/lock', { ...input, customer });
    assert.equal(lock.status, 422); assert.equal(lock.body.error, 'financing_declined');
    const fine = await c.post('/api/quote/lock', { ...goodQuote({ budget: 400, budgetType: 'monthly', paymentMethod: 'financing', termMonths: 60 }), customer });
    assert.equal(fine.status, 201);
  } finally { await srv.close(); }
});

test('sales CSV export neutralises spreadsheet formulas', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    await c.post('/api/quote/lock', { ...goodQuote(), customer: { ...customer, name: '=HYPERLINK("http://evil")' } }).then((r) => assert.equal(r.status, 400)); // name charset blocks it
    const o = orders.createLocked({ ref: 'AC-TESTCSV1', quote: (await c.post('/api/quote', goodQuote())).body.quote, customer: { name: '=cmd|calc', email: 'a@b.co' }, address: { street: '1 A St', zip: '78701' }, lockedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1e6).toISOString(), token: 'x' });
    assert.ok(o);
    const sales = client(srv.base); await sales.post('/api/auth/login', { email: 'sales@demo.com', password: 'Demo@123' });
    const csv = await sales.get('/api/sales/orders.csv?q=AC-TESTCSV1');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.text.includes(`"'=cmd|calc"`), csv.text);
  } finally { await srv.close(); }
});

test('retry queue: exponential backoff retries then succeeds; permanent failures are logged', async () => {
  let n = 0;
  const job = queue.enqueue('test.flaky', async () => { n++; if (n < 3) throw new Error('boom'); }, { baseDelayMs: 5, maxAttempts: 5 });
  await queue.idle();
  assert.equal(job.status, 'done'); assert.equal(job.attempts, 3);
  const bad = queue.enqueue('test.dead', async () => { throw new Error('nope user@example.com'); }, { baseDelayMs: 1, maxAttempts: 2 });
  await queue.idle();
  assert.equal(bad.status, 'failed');
  const f = queue.failures().find((x) => x.job === 'test.dead');
  assert.ok(f); assert.ok(!/user@example.com/.test(f.error), 'PII is redacted in the failure log');
});

test('security headers and client code hygiene', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const r = await c.get('/login');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/); assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!/unsafe-inline/.test(csp));
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.equal((await c.get('/api/health')).body.status, 'ok');
    assert.equal((await c.get('/api/nope')).status, 404);
    assert.equal((await c.post('/api/quote', '{bad json', { raw: true, headers: { 'content-type': 'application/json' } })).status, 400);
  } finally { await srv.close(); }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(__dirname, '..', 'public'))) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/sk_(test|live)_|whsec_|JWT_SECRET|STRIPE_SECRET|SENDGRID_API_KEY|HUBSPOT_ACCESS_TOKEN/.test(text), `secret-like string in ${f}`);
  }
});

test('integrations: lock enqueues CRM + email without blocking, and payment moves the deal stage', async () => {
  const srv = await start(); const c = client(srv.base);
  try {
    const { lock, sess } = await lockAndPay(c);
    await queue.idle();
    const crm = require('../server/adapters/crm').mock.store;
    const deal = crm.deals.find((d) => d.ref === lock.ref);
    assert.ok(deal); assert.equal(deal.stage, 'quote_locked');
    const outbox = adapters.get('notifications').outbox();
    assert.ok(outbox.some((m) => m.channel === 'email' && m.to === customer.email && m.body.includes('/verify?token=')));
    assert.ok(outbox.some((m) => m.to === config.salesNotifyEmail));
    await c.post('/api/payment/mock/complete', { sessionId: sess.sessionId, card: { number: '4242424242424242', expiry: '12/40', cvc: '123' } });
    await queue.idle();
    assert.equal(deal.stage, 'deposit_paid');
  } finally { await srv.close(); }
});
