'use strict';
/** zod schemas: request validation (strict - unknown keys are rejected) and config-file validation. */
const { z } = require('zod');

const ADDRESS_RE = /^\d[A-Za-z0-9\s.,#'\/-]{2,99}$/;
const NAME_RE = /^[\p{L}\p{M}\s.'-]{2,80}$/u;
const slug = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Invalid id');

const quoteFields = {
  budget: z.number().finite().positive().max(200000),
  budgetType: z.enum(['monthly', 'total']).default('total'),
  address: z.string().trim().regex(ADDRESS_RE, 'Enter a valid street address, e.g. 123 Main St'),
  city: z.string().trim().regex(/^[\p{L}\p{M}\s.'-]{1,60}$/u, 'Invalid city').optional(),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter state').optional(),
  zip: z.string().trim().regex(/^\d{5}$/, 'ZIP must be 5 digits'),
  homeSize: slug.optional(),
  systemId: slug,
  tonnage: z.number().positive().max(10).optional(),
  addOnIds: z.array(slug).max(20).default([]).refine((a) => new Set(a).size === a.length, 'Duplicate add-ons'),
  paymentMethod: z.enum(['full', 'financing']),
  termMonths: z.number().int().positive().max(360).optional(),
};

const quoteSchema = z.strictObject(quoteFields).refine((v) => v.paymentMethod !== 'financing' || v.termMonths, {
  message: 'termMonths is required for financing', path: ['termMonths'],
});

const customerSchema = z.strictObject({
  name: z.string().trim().regex(NAME_RE, 'Enter your full name'),
  email: z.string().trim().toLowerCase().email().max(120),
  phone: z.string().trim().regex(/^[0-9+()\-.\s]{7,20}$/, 'Enter a valid phone number').optional().or(z.literal('').transform(() => undefined)),
});

const lockSchema = z.strictObject({ ...quoteFields, customer: customerSchema }).refine((v) => v.paymentMethod !== 'financing' || v.termMonths, {
  message: 'termMonths is required for financing', path: ['termMonths'],
});

const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(1).max(200),
});

const tokenSchema = z.strictObject({ token: z.string().min(20).max(8000) });
const addressQuerySchema = z.object({ q: z.string().trim().min(3).max(100) });

// ---------- config-file schemas (admin editor) ----------
const catalogSchema = z.object({
  _notice: z.string().optional(),
  company: z.object({ name: z.string().min(1).max(80), phone: z.string().max(30), email: z.string().max(120) }),
  brands: z.array(z.object({ id: slug, name: z.string().min(1).max(40), tagline: z.string().max(120) })).min(1),
  systems: z.array(z.object({
    id: slug, brand: slug, tier: z.enum(['Good', 'Better', 'Best']), name: z.string().min(1).max(80),
    tonnageOptions: z.array(z.number().positive().max(10)).min(1),
    seer2: z.number().min(10).max(30), noiseDb: z.number().min(40).max(100), warrantyYears: z.number().int().min(0).max(30),
    basePrice: z.number().min(0).max(100000), image: z.string().max(200), active: z.boolean(),
    highlights: z.array(z.string().max(120)).max(6),
  })).min(1),
  addOns: z.array(z.object({
    id: slug, name: z.string().min(1).max(60), description: z.string().max(200), price: z.number().min(0).max(50000), active: z.boolean(),
  })),
}).superRefine((c, ctx) => {
  const brands = new Set(c.brands.map((b) => b.id));
  const ids = new Set();
  c.systems.forEach((s, i) => {
    if (!brands.has(s.brand)) ctx.addIssue({ code: 'custom', message: `Unknown brand "${s.brand}"`, path: ['systems', i, 'brand'] });
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', message: `Duplicate id "${s.id}"`, path: ['systems', i, 'id'] });
    ids.add(s.id);
  });
  const aIds = new Set();
  c.addOns.forEach((a, i) => {
    if (aIds.has(a.id)) ctx.addIssue({ code: 'custom', message: `Duplicate id "${a.id}"`, path: ['addOns', i, 'id'] });
    aIds.add(a.id);
  });
});

const pricingSchema = z.object({
  _notice: z.string().optional(),
  currency: z.string().length(3),
  taxRatePercent: z.number().min(0).max(25),
  depositPercent: z.number().min(1).max(100),
  priceLockDays: z.number().int().min(1).max(60),
  financingTerms: z.array(z.object({ months: z.number().int().min(1).max(360), aprPercent: z.number().min(0).max(40) })).min(1),
  financingRules: z.object({
    maxPaymentPercentOfMonthlyBudget: z.number().min(10).max(500),
    impliedMonthsForTotalBudget: z.number().int().min(1).max(360),
    manualReviewAboveCents: z.number().int().min(0),
    minimumFinancedCents: z.number().int().min(0),
  }),
  serviceAreaZips: z.array(z.string().regex(/^\d{5}$/)).min(1),
  defaultHomeSize: slug,
  homeSizeMultipliers: z.array(z.object({
    id: slug, label: z.string().min(1).max(60), multiplier: z.number().min(0.5).max(3), suggestedTonnage: z.number().positive().max(10),
  })).min(1),
  tonnageSurcharges: z.record(z.string(), z.number().min(0).max(50000)),
}).superRefine((p, ctx) => {
  if (!p.homeSizeMultipliers.some((h) => h.id === p.defaultHomeSize)) ctx.addIssue({ code: 'custom', message: 'defaultHomeSize must match a home size id', path: ['defaultHomeSize'] });
});

function formatIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

module.exports = { quoteSchema, lockSchema, customerSchema, loginSchema, tokenSchema, addressQuerySchema, catalogSchema, pricingSchema, formatIssues };
