'use strict';
const express = require('express');
const { z } = require('zod');
const adapters = require('../adapters');
const orders = require('../services/orders');
const tokens = require('../services/tokens');
const audit = require('../services/audit');
const log = require('../services/logger');
const events = require('../services/paymentEvents');
const config = require('../config');
const { tokenSchema } = require('../services/schemas');
const { wrap } = require('../middleware/errorHandler');

const router = express.Router();
const SESSION_ID = z.string().regex(/^[A-Za-z0-9_]{10,200}$/);

const mockOnly = (req, res, next) => (adapters.getMode('payments') === 'mock' ? next() : res.status(404).json({ error: 'not_found', message: 'Not available' }));

/**
 * Create a deposit payment session.
 * verify lock token -> server derives the deposit -> adapter creates the session.
 * The client never supplies an amount.
 */
router.post('/session', wrap(async (req, res) => {
  const { token } = tokenSchema.parse(req.body);
  const payload = tokens.verifyLock(token);
  const order = orders.getOrRestore(payload, token);
  if (order.status === 'paid') return res.status(409).json({ error: 'already_paid', message: 'The deposit for this quote has already been paid.' });

  const amountCents = events.expectedDeposit(order);
  if (!Number.isInteger(amountCents) || amountCents < 50) return res.status(400).json({ error: 'bad_amount', message: 'Invalid deposit amount' });

  const description = `Deposit - ${order.quote.system.brandName} ${order.quote.system.name} (${order.ref})`;
  const session = await adapters.get('payments').createDepositSession({ ref: order.ref, amountCents, description, customerEmail: order.customer && order.customer.email });
  orders.setSession(order.ref, session.id, adapters.getMode('payments'));
  audit.record('payment_session', order.customer ? order.customer.email : 'customer', order.ref, { amountCents, provider: adapters.getMode('payments') });
  res.json({ sessionId: session.id, url: session.url, amountCents, mode: adapters.getMode('payments') });
}));

// ---- mock card form backend
router.get('/mock/session', mockOnly, (req, res) => {
  const { id } = z.object({ id: SESSION_ID }).parse(req.query);
  const s = adapters.get('payments').publicSession(id);
  if (!s) return res.status(404).json({ error: 'not_found', message: 'Payment session not found' });
  res.json({ session: s });
});

const cardSchema = z.strictObject({
  sessionId: SESSION_ID,
  card: z.strictObject({ number: z.string().max(30), expiry: z.string().max(10), cvc: z.string().max(5), name: z.string().max(80).optional() }),
});

router.post('/mock/complete', mockOnly, wrap(async (req, res) => {
  const { sessionId, card } = cardSchema.parse(req.body);
  const result = await adapters.get('payments').charge(sessionId, card); // card data is never stored or logged
  if (!result.ok) return res.status(402).json({ error: result.code, message: result.message });
  events.handleEvent(result.event, 'mock-card-form');
  res.json({ ok: true, redirect: `/success?session_id=${sessionId}` });
}));

// ---- success page: confirm with the provider, then mark paid (idempotent)
router.get('/confirm', wrap(async (req, res) => {
  const { session_id: sessionId } = z.object({ session_id: SESSION_ID }).parse(req.query);
  const order = orders.findBySession(sessionId);
  if (!order) return res.status(404).json({ error: 'not_found', message: 'We could not find that payment session. If you were charged, contact us with your reference.' });
  if (order.status !== 'paid') {
    const s = await adapters.get('payments').retrieveSession(sessionId);
    if (s && s.paid) events.handleConfirmedSession(s, 'success-page');
  }
  res.json({ order: orders.publicView(order), verifyUrl: `${config.appUrl}/verify?token=${encodeURIComponent(order.token)}`, token: order.token });
}));

/** Webhook router: mounted BEFORE express.json() because signature verification needs the raw body. */
const webhookRouter = express.Router();
webhookRouter.post('/stripe', express.raw({ type: '*/*', limit: '100kb' }), (req, res) => {
  let event;
  try {
    if (!Buffer.isBuffer(req.body)) throw new Error('no raw body');
    event = adapters.get('payments').verifyWebhook(req.body, req.headers);
  } catch (err) {
    log.warn('webhook signature rejected');
    audit.record('webhook_rejected', 'webhook', null, { reason: 'invalid_signature' });
    return res.status(400).json({ error: 'invalid_signature', message: 'Signature verification failed' });
  }
  const result = events.handleEvent(event, 'webhook');
  res.json({ received: true, duplicate: !!result.duplicate });
});

module.exports = { router, webhookRouter };
