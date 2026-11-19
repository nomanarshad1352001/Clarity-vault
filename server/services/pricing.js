'use strict';
/**
 * Server-side pricing engine. ALL prices come from here, computed from /config JSON.
 * Money is handled in integer cents to avoid floating-point drift.
 * Pure functions: pass { catalog, rules } in (see configStore.getContext()).
 */

class PricingError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.status = status;
  }
}

const toCents = (dollars) => Math.round(dollars * 100);
const pct = (cents, percent) => Math.round((cents * percent) / 100);

function isInServiceArea(zip, rules) {
  return rules.serviceAreaZips.includes(String(zip));
}

function findHomeSize(rules, id) {
  const hs = rules.homeSizeMultipliers.find((h) => h.id === (id || rules.defaultHomeSize));
  if (!hs) throw new PricingError('unknown_home_size', 'Unknown home size');
  return hs;
}

function findSystem(catalog, id) {
  const s = catalog.systems.find((x) => x.id === id && x.active !== false);
  if (!s) throw new PricingError('unknown_system', 'That system is not available');
  return s;
}

/** Pick the available tonnage closest to (and not below) the suggestion; falls back to the largest. */
function defaultTonnage(system, homeSize) {
  const opts = [...system.tonnageOptions].sort((a, b) => a - b);
  return opts.find((t) => t >= homeSize.suggestedTonnage) ?? opts[opts.length - 1];
}

/** Standard amortization. Returns cents. */
function monthlyPaymentCents(principalCents, aprPercent, months) {
  if (principalCents <= 0) return 0;
  const r = aprPercent / 100 / 12;
  if (r === 0) return Math.round(principalCents / months);
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -months)));
}

function financingOption(amountCents, term) {
  const monthly = monthlyPaymentCents(amountCents, term.aprPercent, term.months);
  const totalPayments = monthly * term.months;
  return {
    termMonths: term.months,
    aprPercent: term.aprPercent,
    amountFinancedCents: amountCents,
    monthlyPaymentCents: monthly,
    totalPaymentsCents: totalPayments,
    totalInterestCents: Math.max(0, totalPayments - amountCents),
  };
}

function depositFor(totalCents, rules) {
  return pct(totalCents, rules.depositPercent);
}

function systemLine(system, tonnage, homeSize, rules) {
  const baseCents = toCents(system.basePrice);
  const adjusted = Math.round(baseCents * homeSize.multiplier);
  const surcharge = rules.tonnageSurcharges[String(tonnage)];
  if (surcharge === undefined) throw new PricingError('bad_tonnage', 'Tonnage not priced');
  return { baseCents, homeSizeAdjustmentCents: adjusted - baseCents, tonnageCents: toCents(surcharge) };
}

/**
 * Calculate a full itemised quote.
 * input is already zod-validated; this function still enforces business rules.
 */
function calculateQuote(input, { catalog, rules }) {
  if (!isInServiceArea(input.zip, rules)) {
    throw new PricingError('outside_service_area', "We don't service that ZIP code yet.", 422);
  }
  const system = findSystem(catalog, input.systemId);
  const homeSize = findHomeSize(rules, input.homeSize);
  const tonnage = input.tonnage ?? defaultTonnage(system, homeSize);
  if (!system.tonnageOptions.includes(tonnage)) throw new PricingError('bad_tonnage', 'That tonnage is not offered for this system');

  const brand = catalog.brands.find((b) => b.id === system.brand);
  const line = systemLine(system, tonnage, homeSize, rules);

  const items = [{ kind: 'system', id: system.id, label: `${brand ? brand.name : system.brand} ${system.name} - ${tonnage} ton installed`, amountCents: line.baseCents }];
  if (line.homeSizeAdjustmentCents !== 0) items.push({ kind: 'adjustment', id: homeSize.id, label: `Home size adjustment (${homeSize.label})`, amountCents: line.homeSizeAdjustmentCents });
  if (line.tonnageCents > 0) items.push({ kind: 'adjustment', id: `tonnage-${tonnage}`, label: `${tonnage}-ton capacity upgrade`, amountCents: line.tonnageCents });

  const seen = new Set();
  for (const id of input.addOnIds || []) {
    const addOn = catalog.addOns.find((a) => a.id === id && a.active !== false);
    if (!addOn || seen.has(id)) throw new PricingError('unknown_addon', 'One of the selected add-ons is not available');
    seen.add(id);
    items.push({ kind: 'addon', id: addOn.id, label: addOn.name, amountCents: toCents(addOn.price) });
  }

  const systemCents = items.filter((i) => i.kind !== 'addon').reduce((s, i) => s + i.amountCents, 0);
  const addOnsCents = items.filter((i) => i.kind === 'addon').reduce((s, i) => s + i.amountCents, 0);
  const subtotalCents = systemCents + addOnsCents;
  const taxCents = pct(subtotalCents, rules.taxRatePercent);
  const totalCents = subtotalCents + taxCents;
  const depositCents = depositFor(totalCents, rules);
  const balanceCents = totalCents - depositCents;

  const financingOptions = rules.financingTerms.map((t) => financingOption(balanceCents, t));
  let financing = null;
  if (input.paymentMethod === 'financing') {
    financing = financingOptions.find((o) => o.termMonths === input.termMonths);
    if (!financing) throw new PricingError('bad_term', 'That financing term is not available');
  }

  return {
    currency: rules.currency,
    system: { id: system.id, brand: system.brand, brandName: brand ? brand.name : system.brand, tier: system.tier, name: system.name, tonnage, seer2: system.seer2, noiseDb: system.noiseDb, warrantyYears: system.warrantyYears },
    homeSize: { id: homeSize.id, label: homeSize.label },
    items,
    systemCents,
    addOnsCents,
    subtotalCents,
    taxRatePercent: rules.taxRatePercent,
    taxCents,
    totalCents,
    depositPercent: rules.depositPercent,
    depositCents,
    balanceCents,
    paymentMethod: input.paymentMethod,
    financing,
    financingOptions,
    zip: input.zip,
    budget: { amount: input.budget, type: input.budgetType || 'total' },
  };
}

/**
 * Catalog view with a per-system estimate and budget fit, computed server-side.
 * fit: 'within' | 'stretch' (<=15% over) | 'over'
 */
function estimateSystems({ budget, budgetType, homeSize: homeSizeId }, { catalog, rules }) {
  const homeSize = findHomeSize(rules, homeSizeId);
  const longestTerm = rules.financingTerms.reduce((a, b) => (b.months > a.months ? b : a));
  return catalog.systems.filter((s) => s.active !== false).map((s) => {
    const tonnage = defaultTonnage(s, homeSize);
    const line = systemLine(s, tonnage, homeSize, rules);
    const subtotal = line.baseCents + line.homeSizeAdjustmentCents + line.tonnageCents;
    const total = subtotal + pct(subtotal, rules.taxRatePercent);
    const balance = total - depositFor(total, rules);
    const monthly = financingOption(balance, longestTerm).monthlyPaymentCents;
    let fit = null;
    if (budget) {
      const compare = budgetType === 'monthly' ? monthly : total;
      const limit = toCents(budget);
      fit = compare <= limit ? 'within' : compare <= limit * 1.15 ? 'stretch' : 'over';
    }
    return { ...s, estimate: { tonnage, totalCents: total, lowestMonthlyCents: monthly, lowestMonthlyTermMonths: longestTerm.months }, fit };
  });
}

module.exports = { PricingError, calculateQuote, estimateSystems, monthlyPaymentCents, financingOption, depositFor, isInServiceArea, toCents, defaultTonnage, findHomeSize };
