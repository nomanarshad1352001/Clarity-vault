'use strict';
const express = require('express');
const { validate } = require('../middleware/validate');
const { quoteInputSchema, verifyQuerySchema } = require('../schemas');
const { requireAuth } = require('../middleware/auth');
const { quoteLimiter } = require('../middleware/rateLimit');
const { asyncWrap } = require('../errors');
const pricing = require('../services/pricing');
const quoteLock = require('../services/quoteLock');
const store = require('../services/store');
const integrations = require('../services/integrations');

const router = express.Router();

/**
 * POST /api/quote — the authoritative price. The client sends IDs only;
 * every dollar amount is recomputed here from config.
 */
router.post(
  '/',
  requireAuth,
  quoteLimiter,
  validate(quoteInputSchema),
  asyncWrap(async (req, res) => {
    const quote = pricing.computeQuote(req.body);
    res.json({ quote });
  })
);

/**
 * POST /api/quote/lock — recompute, sign and store. Returns a JWT that IS the
 * price guarantee: it carries the full server-computed quote and expires
 * after pricing-rules.priceLockDays.
 */
router.post(
  '/lock',
  requireAuth,
  quoteLimiter,
  validate(quoteInputSchema),
  asyncWrap(async (req, res) => {
    const quote = pricing.computeQuote(req.body);
    const { token, ref, expiresAt } = quoteLock.createLock(quote, {
      email: req.user.email,
      name: req.user.name,
    });
    const order = store.createOrder({
      ref,
      customerEmail: req.user.email,
      customerName: req.user.name,
      zip: req.body.zip,
      quote,
      lockExpiresAt: expiresAt,
      financingStatus: quote.paymentMethod === 'financing' ? 'prequalified' : null,
    });
    store.addAudit({
      type: 'PRICE_LOCKED',
      actor: req.user.email,
      summary: `Price locked ${ref} — $${quote.total.toFixed(2)} (${quote.system.brand} ${quote.system.name})`,
      meta: { ref, total: quote.total },
    });
    integrations.onQuoteLocked(order, token); // async, never blocks
    res.status(201).json({ token, ref, expiresAt, quote });
  })
);

/** GET /api/quote/verify?token=… — public link from the confirmation email. */
router.get(
  '/verify',
  quoteLimiter,
  validate(verifyQuerySchema, 'query'),
  asyncWrap(async (req, res) => {
    const payload = quoteLock.verifyLock(req.query.token);
    const order = store.getOrderByRef(payload.ref);
    res.json({
      valid: true,
      ref: payload.ref,
      quote: payload.quote,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      status: order ? order.status : 'locked',
    });
  })
);

module.exports = router;
