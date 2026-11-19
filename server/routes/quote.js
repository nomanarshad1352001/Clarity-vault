'use strict';
const express = require('express');
const adapters = require('../adapters');
const configStore = require('../services/configStore');
const pricing = require('../services/pricing');
const tokens = require('../services/tokens');
const orders = require('../services/orders');
const audit = require('../services/audit');
const integrations = require('../services/integrations');
const { quoteSchema, lockSchema, tokenSchema } = require('../services/schemas');
const { wrap } = require('../middleware/errorHandler');

const router = express.Router();

/** Ask the financing adapter about one term. Inputs come from the server-computed quote only. */
async function prequalify(input, quote, option) {
  return adapters.get('financing').prequalify({
    applicantRef: 'prequal',
    amountCents: option.amountFinancedCents,
    termMonths: option.termMonths,
    monthlyPaymentCents: option.monthlyPaymentCents,
    budget: input.budget,
    budgetType: input.budgetType,
    zip: input.zip,
  });
}

// Itemised quote. The client sends choices (ids), never prices.
router.post('/quote', (req, res) => {
  const input = quoteSchema.parse(req.body);
  res.json({ quote: pricing.calculateQuote(input, configStore.getContext()) });
});

// Financing pre-qualification for every term (UI shows the selected one and offers alternatives).
router.post('/financing/prequalify', wrap(async (req, res) => {
  const input = quoteSchema.parse(req.body);
  const quote = pricing.calculateQuote(input, configStore.getContext());
  const fin = adapters.get('financing');
  const terms = [];
  for (const option of quote.financingOptions) {
    const d = await prequalify(input, quote, option);
    terms.push({ termMonths: option.termMonths, aprPercent: option.aprPercent, monthlyPaymentCents: option.monthlyPaymentCents, status: d.status, reasons: d.reasons, decisionId: d.decisionId });
  }
  const selected = terms.find((t) => t.termMonths === input.termMonths) || terms[0];
  const disclosure = (await fin.getTerms(selected.termMonths)).disclosure || '';
  res.json({ selected, terms, disclosure, payInFullTotalCents: quote.totalCents, depositCents: quote.depositCents });
}));

// Lock the price: server recomputes everything, then signs a 7-day token.
router.post('/quote/lock', wrap(async (req, res) => {
  const { customer, ...input } = lockSchema.parse(req.body);
  const ctx = configStore.getContext();
  const quote = pricing.calculateQuote(input, ctx);

  let financing = null;
  if (quote.paymentMethod === 'financing') {
    const d = await prequalify(input, quote, quote.financing);
    if (d.status === 'declined') {
      return res.status(422).json({ error: 'financing_declined', message: 'Financing was not approved for this term.', decision: d });
    }
    financing = { status: d.status, decisionId: d.decisionId, termMonths: quote.financing.termMonths };
  }

  const ref = orders.newRef();
  const lockedAt = new Date();
  const expiresInSec = ctx.rules.priceLockDays * 86400;
  const expiresAt = new Date(lockedAt.getTime() + expiresInSec * 1000);
  const token = tokens.signLock({ ref, quote, financing }, { expiresInSec });

  const order = orders.createLocked({
    ref, quote, customer, financing, token,
    address: { street: input.address, city: input.city || null, state: input.state || null, zip: input.zip },
    lockedAt: lockedAt.toISOString(), expiresAt: expiresAt.toISOString(),
  });
  audit.record('price_lock', customer.email, ref, { totalCents: quote.totalCents, system: quote.system.id, expiresAt: order.expiresAt });
  integrations.onQuoteLocked(order); // queued; never blocks or fails this response

  res.status(201).json({ ref, token, lockedAt: order.lockedAt, expiresAt: order.expiresAt, quote });
}));

// Verify a lock token (signature + expiry). Safe to share: contains no personal data.
router.get('/quote/verify', (req, res) => {
  const { token } = tokenSchema.parse(req.query);
  const p = tokens.verifyLock(token);
  const order = orders.get(p.ref);
  res.json({
    valid: true, ref: p.ref, quote: p.quote,
    lockedAt: new Date(p.iat * 1000).toISOString(), expiresAt: new Date(p.exp * 1000).toISOString(),
    status: order ? orders.effectiveStatus(order) : 'locked', depositPaid: order ? order.status === 'paid' : false,
  });
});

module.exports = router;
