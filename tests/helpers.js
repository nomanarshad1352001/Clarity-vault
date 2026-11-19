'use strict';
// Must run before any server module is required.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.LOG_LEVEL = 'silent';
process.env.QUEUE_BASE_DELAY_MS = '5';
process.env.PAYMENTS_MODE = 'mock';
process.env.FINANCING_MODE = 'mock';
process.env.CRM_MODE = 'mock';
process.env.NOTIFY_MODE = 'mock';
process.env.ADDRESS_MODE = 'mock';
process.env.RATE_LOGIN_PER_15MIN = '100';
process.env.RATE_QUOTE_PER_MIN = '1000';
process.env.RATE_LOCK_PER_MIN = '1000';
process.env.RATE_API_PER_MIN = '5000';

const { createApp } = require('../server/app');

async function start() {
  const server = await new Promise((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/** Tiny HTTP client with a cookie jar and automatic CSRF header. */
function client(base) {
  const jar = {};
  const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  async function req(method, path, body, { csrf = true, headers = {}, raw = false } = {}) {
    if (method !== 'GET' && csrf && !jar.csrf_token) await req('GET', '/api/csrf');
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { ...(raw ? {} : { 'content-type': 'application/json' }), cookie: cookieHeader(), ...(method !== 'GET' && csrf ? { 'x-csrf-token': jar.csrf_token } : {}), ...headers },
      body: body === undefined ? undefined : raw || typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      const name = pair.slice(0, i); const val = pair.slice(i + 1);
      if (val === '' || /expires=Thu, 01 Jan 1970/i.test(c)) delete jar[name]; else jar[name] = val;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers, jar };
  }
  return { get: (p, o) => req('GET', p, undefined, o), post: (p, b, o) => req('POST', p, b, o), put: (p, b, o) => req('PUT', p, b, o), jar };
}

const goodQuote = (over = {}) => ({
  budget: 9000, budgetType: 'total', address: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', homeSize: 'medium',
  systemId: 'goodman-good', addOnIds: ['smart-thermostat'], paymentMethod: 'full', ...over,
});
const customer = { name: 'Test Person', email: 'test.person@example.com', phone: '555-010-1234' };

module.exports = { start, client, goodQuote, customer };
