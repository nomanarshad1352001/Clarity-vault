'use strict';
/**
 * Financing adapter interface (ready for a real lender):
 *   prequalify({ applicantRef, amountCents, termMonths, monthlyPaymentCents, budget, budgetType, zip })
 *        -> { status: 'approved'|'declined'|'pending', decisionId, reasons: string[] }
 *   getOffer({ amountCents, termMonths }) -> { termMonths, aprPercent, monthlyPaymentCents, ... }
 *   getTerms(termMonths) -> { termMonths, aprPercent, disclosure }
 * No SSN / credit data is collected by this app; a real lender flow should redirect to the lender's hosted application.
 */
const crypto = require('crypto');
const configStore = require('../services/configStore');
const { financingOption } = require('../services/pricing');
const { request } = require('./http');
const config = require('../config');

const decisionId = () => `fin_${crypto.randomBytes(6).toString('hex')}`;

const mock = {
  mode: 'mock',
  async prequalify({ amountCents, termMonths, monthlyPaymentCents, budget, budgetType }) {
    const rules = configStore.getPricing().financingRules;
    const reasons = [];
    if (amountCents < rules.minimumFinancedCents) {
      return { status: 'declined', decisionId: decisionId(), reasons: ['The amount to finance is below the lender minimum. Paying in full is simpler for this order.'] };
    }
    const monthlyBudget = budgetType === 'monthly' ? budget : budget / rules.impliedMonthsForTotalBudget;
    const limit = (monthlyBudget * rules.maxPaymentPercentOfMonthlyBudget) / 100;
    if (monthlyPaymentCents / 100 > limit) {
      return { status: 'declined', decisionId: decisionId(), reasons: [`The ${termMonths}-month payment is higher than your stated budget allows. A longer term or paying in full may work.`] };
    }
    if (amountCents > rules.manualReviewAboveCents) {
      reasons.push('Larger financed amounts need a quick manual review by our lending partner.');
      return { status: 'pending', decisionId: decisionId(), reasons };
    }
    return { status: 'approved', decisionId: decisionId(), reasons: ['Pre-qualified based on your budget. No credit pull has been made.'] };
  },
  async getOffer({ amountCents, termMonths }) {
    const term = configStore.getPricing().financingTerms.find((t) => t.months === termMonths);
    if (!term) throw new Error('Unknown term');
    return financingOption(amountCents, term);
  },
  async getTerms(termMonths) {
    const term = configStore.getPricing().financingTerms.find((t) => t.months === termMonths);
    if (!term) throw new Error('Unknown term');
    return { termMonths, aprPercent: term.aprPercent, disclosure: 'DEMO TERMS - placeholder text. Real lender disclosures replace this. Subject to lender approval; APR and terms may vary.' };
  },
};

/** Generic REST lender skeleton. Adapt paths / payloads / auth to your lender's API contract. */
const headers = () => ({ Authorization: `Bearer ${config.env('FINANCING_API_KEY')}` });
const base = () => config.env('FINANCING_API_URL').replace(/\/$/, '');

const live = {
  mode: 'live',
  async prequalify(input) {
    const r = await request(`${base()}/prequalify`, { method: 'POST', headers: headers(), body: input });
    const status = ['approved', 'declined', 'pending'].includes(r && r.status) ? r.status : 'pending';
    return { status, decisionId: (r && r.decisionId) || decisionId(), reasons: (r && r.reasons) || [] };
  },
  async getOffer(input) { return request(`${base()}/offers`, { method: 'POST', headers: headers(), body: input }); },
  async getTerms(termMonths) { return request(`${base()}/terms?months=${encodeURIComponent(termMonths)}`, { headers: headers() }); },
};

const problems = () => ['FINANCING_API_URL', 'FINANCING_API_KEY'].filter((k) => !config.env(k));

module.exports = { mock, live, problems };
