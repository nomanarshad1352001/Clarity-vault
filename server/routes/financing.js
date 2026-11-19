'use strict';
const express = require('express');
const { validate } = require('../middleware/validate');
const { prequalifySchema } = require('../schemas');
const { requireAuth } = require('../middleware/auth');
const { asyncWrap, AppError } = require('../errors');
const adapters = require('../adapters');
const pricing = require('../services/pricing');
const store = require('../services/store');

const router = express.Router();

router.get(
  '/terms',
  requireAuth,
  asyncWrap(async (req, res) => {
    const terms = await adapters.getFinancing().getTerms();
    res.json({ terms });
  })
);

/**
 * POST /api/financing/prequalify — quote is recomputed server-side; the
 * decision uses the stated monthly budget vs. the real monthly payment.
 */
router.post(
  '/prequalify',
  requireAuth,
  validate(prequalifySchema),
  asyncWrap(async (req, res) => {
    const input = { ...req.body.quote, paymentMethod: 'financing' };
    if (!input.termMonths) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a financing term first.');
    const quote = pricing.computeQuote(input);
    const fin = adapters.getFinancing();
    const result = await fin.prequalify({
      applicant: { email: req.user.email, name: req.user.name },
      monthlyPayment: quote.financing.monthlyPayment,
      statedMonthlyBudget: req.body.statedMonthlyBudget,
      termMonths: quote.financing.months,
      principal: quote.financing.principal,
    });
    store.addAudit({
      type: 'FINANCING_DECISION',
      actor: req.user.email,
      summary: `Financing ${result.status} — $${quote.financing.monthlyPayment.toFixed(2)}/mo for ${quote.financing.months} mo`,
      meta: { status: result.status, monthlyPayment: quote.financing.monthlyPayment },
    });
    res.json({ result, financing: quote.financing });
  })
);

module.exports = router;
