'use strict';
const express = require('express');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { catalogSchema, pricingRulesSchema, integrationToggleSchema } = require('../schemas');
const { AppError, asyncWrap } = require('../errors');
const configStore = require('../configStore');
const store = require('../services/store');

const router = express.Router();
router.use(requireRole('admin'));

const PLACEHOLDER_NOTES = {
  'catalog.json': 'PLACEHOLDER DATA — replace every price, spec and image with real catalog data before go-live.',
  'pricing-rules.json': 'PLACEHOLDER PRICING RULES — all rates, terms and service areas are demo values to be replaced before go-live.',
};

router.get('/catalog', (req, res) => {
  res.json({ catalog: configStore.getCatalog() });
});

router.put(
  '/catalog',
  validate(catalogSchema),
  asyncWrap(async (req, res) => {
    const data = { _comment: PLACEHOLDER_NOTES['catalog.json'], ...req.body };
    configStore.writeJson('catalog.json', data);
    store.addAudit({
      type: 'ADMIN_CATALOG_UPDATED',
      actor: req.user.email,
      summary: `Catalog updated (${data.systems.length} systems, ${data.addOns.length} add-ons)`,
    });
    res.json({ ok: true, systems: data.systems.length, addOns: data.addOns.length });
  })
);

router.get('/pricing-rules', (req, res) => {
  res.json({ pricingRules: configStore.getPricingRules() });
});

router.put(
  '/pricing-rules',
  validate(pricingRulesSchema),
  asyncWrap(async (req, res) => {
    const data = { _comment: PLACEHOLDER_NOTES['pricing-rules.json'], ...req.body };
    configStore.writeJson('pricing-rules.json', data);
    store.addAudit({
      type: 'ADMIN_PRICING_UPDATED',
      actor: req.user.email,
      summary: `Pricing rules updated (tax ${(data.taxRate * 100).toFixed(2)}%, deposit ${(data.depositPercent * 100).toFixed(0)}%, ${data.serviceAreaZips.length} ZIPs)`,
    });
    res.json({ ok: true });
  })
);

const LIVE_REQUIREMENTS = {
  payments: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  financing: [], // no live lender wired yet — toggling is blocked below
  crm: ['HUBSPOT_ACCESS_TOKEN'],
  email: ['SENDGRID_API_KEY'],
  sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
  address: ['GOOGLE_PLACES_API_KEY'],
};

router.get('/integrations', (req, res) => {
  const summary = configStore.adapterSummary().map((entry) => ({
    ...entry,
    liveConfigured: LIVE_REQUIREMENTS[entry.domain].every((k) => !!process.env[k]),
    requiredEnv: LIVE_REQUIREMENTS[entry.domain],
  }));
  res.json({ integrations: summary, note: 'Runtime toggles are in-memory; env vars win on restart.' });
});

router.post(
  '/integrations',
  validate(integrationToggleSchema),
  asyncWrap(async (req, res) => {
    const { domain, mode } = req.body;
    if (domain === 'financing' && mode === 'live') {
      throw new AppError(422, 'FINANCING_NOT_CONFIGURED', 'No live lender is wired up yet — the adapter interface is ready (see server/adapters/financing.js).');
    }
    if (mode === 'live') {
      const missing = LIVE_REQUIREMENTS[domain].filter((k) => !process.env[k]);
      if (missing.length) {
        throw new AppError(422, 'ADAPTER_NOT_CONFIGURED', `Cannot switch ${domain} to live — missing env vars: ${missing.join(', ')}.`, { missing });
      }
    }
    configStore.setAdapterOverride(domain, mode);
    store.addAudit({
      type: 'ADMIN_ADAPTER_TOGGLED',
      actor: req.user.email,
      summary: `${domain} adapter → ${mode}`,
      meta: { domain, mode },
    });
    res.json({ ok: true, ...configStore.adapterMode(domain) });
  })
);

router.get('/audit', (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : null;
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json({ entries: store.listAudit({ type, limit }) });
});

module.exports = router;
