'use strict';
const express = require('express');
const configStore = require('../configStore');
const pricing = require('../services/pricing');
const { AppError } = require('../errors');

const router = express.Router();

/** Public product catalog + the pricing facts the UI needs for labels. */
router.get('/', (req, res) => {
  const catalog = configStore.getCatalog();
  const rules = configStore.getPricingRules();
  const systems = catalog.systems.map((s) => {
    const total = pricing.round2(s.baseInstalledPrice * (1 + rules.taxRate));
    const deposit = pricing.round2(total * rules.depositPercent);
    return {
      ...s,
      estimatedMonthly: pricing.estimateMonthly(total, deposit, rules),
      estimatedTotal: total,
    };
  });
  res.json({
    brands: catalog.brands,
    systems,
    addOns: catalog.addOns,
    pricing: {
      currency: rules.currency,
      taxRate: rules.taxRate,
      depositPercent: rules.depositPercent,
      priceLockDays: rules.priceLockDays,
      financingTerms: rules.financing.terms,
      sqftPerTon: rules.sqftPerTon,
      serviceAreaLabel: rules.serviceAreaLabel,
      tonnagePriceDelta: rules.tonnagePriceDelta,
      homeSizeMultipliers: rules.homeSizeMultipliers,
    },
  });
});

router.get('/systems/:id', (req, res, next) => {
  const system = configStore.getCatalog().systems.find((s) => s.id === req.params.id);
  if (!system) return next(new AppError(404, 'UNKNOWN_SYSTEM', 'System not found.'));
  return res.json({ system });
});

module.exports = router;
