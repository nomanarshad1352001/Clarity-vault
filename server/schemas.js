'use strict';
/**
 * schemas — zod schemas shared by routes and admin endpoints.
 * Strict by construction: unknown keys are stripped, every value range-checked.
 */
const { z } = require('zod');

const zipSchema = z.string().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code.');

const budgetSchema = z
  .object({
    type: z.enum(['monthly', 'total']),
    amount: z.number().positive().max(100000),
  })
  .nullable()
  .optional();

const quoteInputSchema = z.object({
  budget: budgetSchema,
  address: z.string().trim().min(3).max(200),
  zip: zipSchema,
  homeSqft: z.number().int().min(300).max(15000),
  systemId: z.string().trim().min(1).max(64),
  tonnageTons: z.number().min(1).max(7.5),
  addOnIds: z.array(z.string().trim().min(1).max(64)).max(16).default([]),
  paymentMethod: z.enum(['full', 'financing']),
  termMonths: z.number().int().positive().max(120).nullable().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

const addressCheckSchema = z.object({ zip: zipSchema });

const cardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  number: z.string().trim().regex(/^[\d\s]{12,23}$/, 'Enter a valid card number.'),
  exp: z.string().trim().regex(/^(0[1-9]|1[0-2])\s*\/\s*\d{2}$/, 'Use MM/YY.'),
  cvc: z.string().trim().regex(/^\d{3,4}$/, 'Invalid CVC.'),
});

const depositSchema = z.object({
  lockToken: z.string().min(20).max(4096),
  card: cardSchema.optional(),
});

const prequalifySchema = z.object({
  quote: quoteInputSchema,
  statedMonthlyBudget: z.number().positive().max(100000),
});

const verifyQuerySchema = z.object({ token: z.string().min(20).max(4096) });

/* --- Admin schemas ---------------------------------------------------------*/

const systemSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]+$/).max(64),
  brand: z.string().trim().min(1).max(40),
  tier: z.enum(['good', 'better', 'best']),
  name: z.string().trim().min(1).max(80),
  tonnageOptions: z.array(z.number().min(1).max(7.5)).min(1).max(12),
  seer2: z.number().min(10).max(30),
  noiseDb: z.number().int().min(40).max(90),
  warrantyYears: z.number().int().min(1).max(25),
  baseInstalledPrice: z.number().positive().max(100000),
  image: z.string().trim().max(300),
  blurb: z.string().trim().max(300).optional().default(''),
});

const addOnSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]+$/).max(64),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  price: z.number().nonnegative().max(50000),
  category: z.string().trim().max(40),
});

const catalogSchema = z.object({
  brands: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  systems: z.array(systemSchema).min(1).max(60),
  addOns: z.array(addOnSchema).min(1).max(40),
});

const termSchema = z.object({
  months: z.number().int().min(3).max(120),
  apr: z.number().min(0).max(0.35),
});

const pricingRulesSchema = z.object({
  currency: z.literal('USD'),
  taxRate: z.number().min(0).max(0.25),
  depositPercent: z.number().min(0.01).max(1),
  priceLockDays: z.number().int().min(1).max(30),
  sqftPerTon: z.number().int().min(200).max(1200),
  serviceAreaLabel: z.string().trim().min(2).max(120),
  serviceAreaZips: z.array(zipSchema).min(1).max(5000),
  homeSizeMultipliers: z
    .array(
      z.object({
        maxSqft: z.number().int().positive().max(50000).nullable(),
        multiplier: z.number().min(0.5).max(2),
        label: z.string().trim().min(1).max(80),
      })
    )
    .min(1)
    .max(10),
  tonnagePriceDelta: z.record(z.string(), z.number().min(-10000).max(10000)),
  financing: z.object({
    terms: z.array(termSchema).min(1).max(8),
    mockRules: z.object({
      approveUpToBudgetRatio: z.number().min(0.1).max(3),
      reviewUpToBudgetRatio: z.number().min(0.1).max(3),
    }),
  }),
});

const integrationToggleSchema = z.object({
  domain: z.enum(['payments', 'financing', 'crm', 'email', 'sms', 'address']),
  mode: z.enum(['mock', 'live']),
});

module.exports = {
  quoteInputSchema,
  loginSchema,
  addressCheckSchema,
  depositSchema,
  prequalifySchema,
  verifyQuerySchema,
  catalogSchema,
  pricingRulesSchema,
  integrationToggleSchema,
};
