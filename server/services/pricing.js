'use strict';
/**
 * pricing — the ONLY place prices are calculated. Everything is derived from
 * /config JSON at request time. The client sends IDs and quantities; this
 * service returns the authoritative itemized quote. Unknown IDs are rejected.
 */
const { AppError } = require('../errors');
const configStore = require('../configStore');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function findSystem(catalog, systemId) {
  const system = catalog.systems.find((s) => s.id === systemId);
  if (!system) throw new AppError(422, 'UNKNOWN_SYSTEM', 'Unknown system selected.');
  return system;
}

function homeSizeRule(rules, homeSqft) {
  return (
    rules.homeSizeMultipliers.find((m) => m.maxSqft === null || homeSqft <= m.maxSqft) ||
    rules.homeSizeMultipliers[rules.homeSizeMultipliers.length - 1]
  );
}

function assertServiceArea(rules, zip) {
  if (!rules.serviceAreaZips.includes(zip)) {
    throw new AppError(
      422,
      'OUTSIDE_SERVICE_AREA',
      `We're not serving ${zip} yet — we currently install in ${rules.serviceAreaLabel}.`
    );
  }
}

/** Standard amortization: M = P·r / (1 − (1+r)^−n). APR of 0 → straight division. */
function monthlyPayment(principal, apr, months) {
  if (principal <= 0 || months <= 0) return 0;
  const r = apr / 12;
  if (r === 0) return round2(principal / months);
  return round2((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/**
 * computeQuote(input) → authoritative quote object.
 * input: { systemId, tonnageTons, addOnIds[], homeSqft, zip, paymentMethod, termMonths?, budget? }
 */
function computeQuote(input) {
  const catalog = configStore.getCatalog();
  const rules = configStore.getPricingRules();

  assertServiceArea(rules, input.zip);

  const system = findSystem(catalog, input.systemId);
  if (!system.tonnageOptions.includes(input.tonnageTons)) {
    throw new AppError(422, 'INVALID_TONNAGE', 'Selected tonnage is not available for this system.');
  }

  const addOnIds = [...new Set(input.addOnIds || [])];
  const addOns = addOnIds.map((id) => {
    const a = catalog.addOns.find((x) => x.id === id);
    if (!a) throw new AppError(422, 'UNKNOWN_ADDON', `Unknown add-on: ${id}`);
    return { id: a.id, name: a.name, price: a.price };
  });

  const sizeRule = homeSizeRule(rules, input.homeSqft);
  const tonnageDelta = Number(rules.tonnagePriceDelta[String(input.tonnageTons)] || 0);

  const adjustments = [];
  if (tonnageDelta !== 0) {
    adjustments.push({ label: `${input.tonnageTons}-ton capacity`, amount: tonnageDelta });
  }
  const systemPrice = round2((system.baseInstalledPrice + tonnageDelta) * sizeRule.multiplier);
  if (sizeRule.multiplier !== 1) {
    adjustments.push({
      label: `Home size (${sizeRule.label})`,
      amount: round2(systemPrice - (system.baseInstalledPrice + tonnageDelta)),
    });
  }

  const addOnsTotal = round2(addOns.reduce((sum, a) => sum + a.price, 0));
  const subtotal = round2(systemPrice + addOnsTotal);
  const tax = round2(subtotal * rules.taxRate);
  const total = round2(subtotal + tax);
  const deposit = round2(total * rules.depositPercent);

  let financing = null;
  if (input.paymentMethod === 'financing') {
    const term = rules.financing.terms.find((t) => t.months === input.termMonths);
    if (!term) throw new AppError(422, 'INVALID_TERM', 'Choose one of the available financing terms.');
    const principal = round2(total - deposit); // deposit is paid today, remainder financed
    const monthly = monthlyPayment(principal, term.apr, term.months);
    financing = {
      months: term.months,
      apr: term.apr,
      principal,
      monthlyPayment: monthly,
      totalOfPayments: round2(monthly * term.months + deposit),
      totalInterest: round2(monthly * term.months - principal),
    };
  }

  const quote = {
    system: {
      id: system.id,
      brand: system.brand,
      name: system.name,
      tier: system.tier,
      tons: input.tonnageTons,
      seer2: system.seer2,
      noiseDb: system.noiseDb,
      warrantyYears: system.warrantyYears,
      baseInstalledPrice: system.baseInstalledPrice,
      price: systemPrice,
    },
    adjustments,
    addOns,
    addOnsTotal,
    subtotal,
    taxRate: rules.taxRate,
    tax,
    total,
    depositPercent: rules.depositPercent,
    deposit,
    paymentMethod: input.paymentMethod,
    financing,
    currency: rules.currency,
    priceLockDays: rules.priceLockDays,
    homeSqft: input.homeSqft,
    zip: input.zip,
  };

  if (input.budget && input.budget.amount > 0) {
    quote.budgetFit = budgetFit(input.budget, quote, rules);
  }
  return quote;
}

function budgetFit(budget, quote, rules) {
  if (budget.type === 'total') {
    if (quote.total <= budget.amount) return 'within';
    if (quote.total <= budget.amount * 1.1) return 'stretch';
    return 'over';
  }
  const term = rules.financing.terms[rules.financing.terms.length - 1]; // longest term
  const monthly = monthlyPayment(round2(quote.total - quote.deposit), term.apr, term.months);
  if (monthly <= budget.amount) return 'within';
  if (monthly <= budget.amount * 1.1) return 'stretch';
  return 'over';
}

/** Estimated monthly for display on system cards (longest available term). */
function estimateMonthly(total, deposit, rules) {
  const term = rules.financing.terms[rules.financing.terms.length - 1];
  return monthlyPayment(round2(total - deposit), term.apr, term.months);
}

module.exports = { computeQuote, monthlyPayment, estimateMonthly, round2, homeSizeRule };
