'use strict';
const express = require('express');
const { z } = require('zod');
const config = require('../config');
const adapters = require('../adapters');
const configStore = require('../services/configStore');
const pricing = require('../services/pricing');
const { wrap } = require('../middleware/errorHandler');
const { addressQuerySchema } = require('../services/schemas');

const router = express.Router();

// Safe, non-secret flags for the browser.
router.get('/config', (req, res) => {
  res.json({
    demoAutofill: config.demoAutofill,
    demoMode: config.demoAutofill || adapters.anyMock(),
    paymentsMode: adapters.getMode('payments'),
    addressMode: adapters.getMode('address'),
    company: configStore.getCatalog().company,
    user: req.user ? { email: req.user.email, name: req.user.name, role: req.user.role } : null,
  });
});

const catalogQuery = z.object({
  budget: z.coerce.number().positive().max(200000).optional(),
  budgetType: z.enum(['monthly', 'total']).default('total'),
  homeSize: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
});

router.get('/catalog', (req, res) => {
  const q = catalogQuery.parse(req.query);
  const ctx = configStore.getContext();
  const { catalog, rules } = ctx;
  res.json({
    company: catalog.company,
    brands: catalog.brands,
    systems: pricing.estimateSystems(q, ctx),
    addOns: catalog.addOns.filter((a) => a.active !== false).map((a) => ({ ...a, priceCents: pricing.toCents(a.price) })),
    homeSizes: rules.homeSizeMultipliers.map(({ id, label, suggestedTonnage }) => ({ id, label, suggestedTonnage })),
    defaultHomeSize: rules.defaultHomeSize,
    financingTerms: rules.financingTerms,
    depositPercent: rules.depositPercent,
    priceLockDays: rules.priceLockDays,
    taxRatePercent: rules.taxRatePercent,
    tonnageSurcharges: rules.tonnageSurcharges,
  });
});

// ---- address lookup + service-area check
router.get('/address/suggest', wrap(async (req, res) => {
  const { q } = addressQuerySchema.parse(req.query);
  let suggestions = [];
  try { suggestions = await adapters.get('address').suggest(q); } catch { suggestions = []; } // lookup is a convenience; never block typing manually
  res.json({ suggestions });
}));

router.get('/address/details', wrap(async (req, res) => {
  const { id } = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{3,200}$/) }).parse(req.query);
  const d = await adapters.get('address').details(id);
  if (!d) return res.status(404).json({ error: 'not_found', message: 'Address not found' });
  res.json({ address: d, inServiceArea: pricing.isInServiceArea(d.zip, configStore.getPricing()) });
}));

router.get('/address/check', (req, res) => {
  const { zip } = z.object({ zip: z.string().regex(/^\d{5}$/, 'ZIP must be 5 digits') }).parse(req.query);
  const inServiceArea = pricing.isInServiceArea(zip, configStore.getPricing());
  res.json({ zip, inServiceArea, message: inServiceArea ? 'Great news - we install in your area!' : "We don't install in that ZIP code yet. Leave your email on the contact page and we'll tell you when we expand." });
});

module.exports = router;
