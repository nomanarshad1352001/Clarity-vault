'use strict';
/**
 * Payment adapter interface (both implementations must provide):
 *   createDepositSession({ ref, amountCents, description, customerEmail }) -> { id, url }
 *   retrieveSession(id)  -> { id, ref, paid, amountCents } | null
 *   verifyWebhook(rawBodyBuffer, headers) -> event   (throws on bad signature)
 * Amounts are ALWAYS supplied by the server. Events use Stripe's shape:
 *   { id, type: 'checkout.session.completed', data: { object: { id, payment_status, amount_total, metadata: { ref } } } }
 */
const crypto = require('crypto');
const config = require('../config');

// ---------------------------------------------------------------- MOCK
const sessions = new Map();

function luhn(num) {
  let sum = 0; let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

const mockSign = (raw) => `sha256=${crypto.createHmac('sha256', config.secrets.mockWebhook).update(raw).digest('hex')}`;

const mock = {
  mode: 'mock',
  async createDepositSession({ ref, amountCents, description }) {
    const id = `mock_cs_${crypto.randomBytes(12).toString('hex')}`;
    sessions.set(id, { id, ref, amountCents, description, status: 'open' });
    return { id, url: `/pay/mock?session=${id}` };
  },
  async retrieveSession(id) {
    const s = sessions.get(id);
    return s ? { id, ref: s.ref, paid: s.status === 'paid', amountCents: s.amountCents } : null;
  },
  publicSession(id) {
    const s = sessions.get(id);
    return s ? { id: s.id, ref: s.ref, amountCents: s.amountCents, description: s.description, status: s.status } : null;
  },
  /** Simulates the card form. Test numbers: 4242 4242 4242 4242 ok, 4000 0000 0000 0002 declined, 4000 0000 0000 9995 insufficient funds. */
  async charge(id, card) {
    const s = sessions.get(id);
    if (!s) return { ok: false, code: 'session_not_found', message: 'Payment session not found.' };
    if (s.status === 'paid') return { ok: false, code: 'already_paid', message: 'This deposit was already paid.' };
    const num = String(card.number || '').replace(/\s+/g, '');
    if (!/^\d{13,19}$/.test(num) || !luhn(num)) return { ok: false, code: 'incorrect_number', message: 'The card number is not valid.' };
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(card.expiry || ''));
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { ok: false, code: 'invalid_expiry', message: 'Enter the expiry as MM/YY.' };
    const expiresAt = new Date(2000 + Number(m[2]), Number(m[1]), 1);
    if (expiresAt <= new Date()) return { ok: false, code: 'expired_card', message: 'This card has expired.' };
    if (!/^\d{3,4}$/.test(String(card.cvc || ''))) return { ok: false, code: 'invalid_cvc', message: 'Enter the 3 or 4 digit security code.' };
    if (num === '4000000000000002') return { ok: false, code: 'card_declined', message: 'Your card was declined.' };
    if (num === '4000000000009995') return { ok: false, code: 'insufficient_funds', message: 'Your card has insufficient funds.' };
    s.status = 'paid';
    return { ok: true, event: mock.buildEvent(s) };
  },
  buildEvent(s) {
    return { id: `evt_mock_${crypto.randomBytes(8).toString('hex')}`, type: 'checkout.session.completed', data: { object: { id: s.id, payment_status: 'paid', amount_total: s.amountCents, metadata: { ref: s.ref } } } };
  },
  signPayload: mockSign,
  verifyWebhook(raw, headers) {
    const given = String(headers['x-mock-signature'] || '');
    const expected = mockSign(raw);
    const a = Buffer.from(given); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid webhook signature');
    return JSON.parse(raw.toString('utf8'));
  },
};

// ---------------------------------------------------------------- LIVE (Stripe Checkout)
let stripeClient;
const stripe = () => {
  if (!stripeClient) {
    const Stripe = require('stripe');
    stripeClient = new Stripe(config.env('STRIPE_SECRET_KEY'));
  }
  return stripeClient;
};

const live = {
  mode: 'live',
  async createDepositSession({ ref, amountCents, description, customerEmail }) {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      client_reference_id: ref,
      customer_email: customerEmail || undefined,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: description } } }],
      metadata: { ref },
      payment_intent_data: { metadata: { ref } },
      success_url: `${config.appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.appUrl}/quote?resume=1`,
    });
    return { id: session.id, url: session.url };
  },
  async retrieveSession(id) {
    const s = await stripe().checkout.sessions.retrieve(id);
    return { id: s.id, ref: s.metadata && s.metadata.ref, paid: s.payment_status === 'paid', amountCents: s.amount_total };
  },
  verifyWebhook(raw, headers) {
    return stripe().webhooks.constructEvent(raw, headers['stripe-signature'], config.env('STRIPE_WEBHOOK_SECRET'));
  },
};

/** Returns a list of missing env vars; Stripe live is refused for sk_live keys unless explicitly allowed. */
function problems() {
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].filter((k) => !config.env(k));
  if (config.env('STRIPE_SECRET_KEY').startsWith('sk_live_') && config.env('STRIPE_ALLOW_LIVE_KEYS') !== 'true') missing.push('STRIPE_ALLOW_LIVE_KEYS (a live key was supplied; test mode only)');
  return missing;
}

module.exports = { mock, live, problems };
