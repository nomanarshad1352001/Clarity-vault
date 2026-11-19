'use strict';
const express = require('express');
const { validate } = require('../middleware/validate');
const { depositSchema } = require('../schemas');
const { requireAuth } = require('../middleware/auth');
const { asyncWrap, AppError } = require('../errors');
const adapters = require('../adapters');
const quoteLock = require('../services/quoteLock');
const store = require('../services/store');
const integrations = require('../services/integrations');

const router = express.Router();

function baseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

router.get('/config', requireAuth, (req, res) => {
  const { mode } = require('../configStore').adapterMode('payments');
  res.json({ mode, currency: 'USD' });
});

/**
 * POST /api/payments/deposit
 * The amount is ALWAYS derived from the signed lock token — the client only
 * sends the token and (in mock mode) card details.
 */
router.post(
  '/deposit',
  requireAuth,
  validate(depositSchema),
  asyncWrap(async (req, res) => {
    const lock = quoteLock.verifyLock(req.body.lockToken); // 401 invalid / 410 expired
    const order = store.getOrderByRef(lock.ref);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'We could not find that price lock.');
    if (order.status === 'paid') {
      return res.json({ status: 'already_paid', order: { ref: order.ref, status: order.status, paidAt: order.paidAt } });
    }

    const depositCents = Math.round(lock.quote.deposit * 100);
    const payments = adapters.getPayments();

    if (payments.mode === 'live') {
      const session = await payments.createDepositCheckout({
        amountCents: depositCents,
        ref: lock.ref,
        email: req.user.email,
        successUrl: `${baseUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl()}/quote?canceled=1`,
      });
      store.updateOrder(order.id, { stripeSessionId: session.sessionId });
      return res.json({ status: 'checkout', checkoutUrl: session.checkoutUrl });
    }

    try {
      const result = await payments.chargeDeposit({
        amountCents: depositCents,
        card: req.body.card,
        ref: lock.ref,
        email: req.user.email,
      });
      store.updateOrder(order.id, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        paymentId: result.paymentId,
        cardLast4: result.last4,
      });
      store.addAudit({
        type: 'PAYMENT_SUCCEEDED',
        actor: req.user.email,
        summary: `Deposit paid on ${order.ref} — $${lock.quote.deposit.toFixed(2)}`,
        meta: { ref: order.ref, amountCents: depositCents },
      });
      integrations.onPaymentSucceeded(order);
      return res.json({
        status: 'succeeded',
        deposit: lock.quote.deposit,
        paymentId: result.paymentId,
        order: { ref: order.ref, status: order.status, paidAt: order.paidAt },
      });
    } catch (err) {
      if (err instanceof AppError && err.status === 402) {
        store.addAudit({
          type: 'PAYMENT_FAILED',
          actor: req.user.email,
          summary: `Deposit declined on ${order.ref} (${err.code})`,
          meta: { ref: order.ref, code: err.code },
        });
      }
      throw err;
    }
  })
);

/**
 * POST /api/payments/webhook — Stripe → us. Raw body + signature verification;
 * idempotent via the processed-event set.
 */
router.post(
  '/webhook',
  asyncWrap(async (req, res) => {
    const payments = adapters.getPayments();
    if (payments.mode !== 'live') {
      throw new AppError(400, 'WEBHOOK_DISABLED', 'Webhooks are only available in live payment mode.');
    }
    const signature = req.get('stripe-signature') || '';
    let event;
    try {
      event = payments.constructWebhookEvent(req.body, signature);
    } catch {
      store.addAudit({ type: 'WEBHOOK_REJECTED', actor: 'stripe', summary: 'Webhook signature verification failed' });
      throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
    }
    if (!store.rememberWebhookEvent(event.id)) {
      return res.json({ received: true, duplicate: true });
    }
    if (event.type === 'checkout.session.completed') {
      const ref = event.data && event.data.object && event.data.object.metadata && event.data.object.metadata.ref;
      const order = ref ? store.getOrderByRef(ref) : null;
      if (order && order.status !== 'paid') {
        store.updateOrder(order.id, {
          status: 'paid',
          paidAt: new Date().toISOString(),
          paymentId: String(event.data.object.payment_intent || ''),
        });
        store.addAudit({
          type: 'PAYMENT_SUCCEEDED',
          actor: 'stripe-webhook',
          summary: `Deposit paid on ${order.ref} (Checkout ${event.data.object.id})`,
          meta: { ref: order.ref },
        });
        integrations.onPaymentSucceeded(order);
      }
    }
    return res.json({ received: true });
  })
);

/** Success-page helper: confirm a Checkout Session after redirect (webhook stays authoritative). */
router.get(
  '/session-status',
  requireAuth,
  asyncWrap(async (req, res) => {
    const payments = adapters.getPayments();
    if (payments.mode !== 'live') throw new AppError(400, 'LIVE_ONLY', 'Session status is only used in live mode.');
    const sessionId = String(req.query.session_id || '');
    if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) throw new AppError(400, 'VALIDATION_ERROR', 'Bad session id.');
    const session = await payments.retrieveSession(sessionId);
    const ref = session.metadata && session.metadata.ref;
    const order = ref ? store.getOrderByRef(ref) : null;
    if (session.payment_status === 'paid' && order && order.status !== 'paid') {
      store.updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString(), paymentId: String(session.payment_intent || '') });
      store.addAudit({ type: 'PAYMENT_SUCCEEDED', actor: 'stripe-redirect', summary: `Deposit confirmed on ${order.ref}`, meta: { ref: order.ref } });
      integrations.onPaymentSucceeded(order);
    }
    return res.json({ status: session.payment_status, ref: ref || null, orderStatus: order ? order.status : null });
  })
);

module.exports = router;
