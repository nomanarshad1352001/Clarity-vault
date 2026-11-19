'use strict';
/**
 * financing adapter — interface ready for a real lender:
 *   getTerms()                                   → available terms
 *   prequalify({ applicant, monthlyPayment, statedMonthlyBudget, termMonths, principal }) → decision
 *   getOffer(applicationId)                      → firm offer after full application
 *
 * Mock rules (config: pricing-rules.financing.mockRules):
 *   monthly ≤ budget × approveUpToBudgetRatio   → approved
 *   monthly ≤ budget × reviewUpToBudgetRatio    → pending_review
 *   otherwise                                   → declined
 */
const crypto = require('crypto');
const configStore = require('../configStore');
const { AppError } = require('../errors');
const logger = require('../logger');
const { round2 } = require('../services/pricing');

class MockFinancing {
  constructor() {
    this.mode = 'mock';
  }

  async getTerms() {
    return configStore.getPricingRules().financing.terms;
  }

  async prequalify({ monthlyPayment, statedMonthlyBudget, termMonths, principal }) {
    const rules = configStore.getPricingRules().financing;
    const term = rules.terms.find((t) => t.months === termMonths);
    if (!term) throw new AppError(422, 'INVALID_TERM', 'Choose one of the available financing terms.');
    const ratio = monthlyPayment / statedMonthlyBudget;
    const applicationId = `fin_mock_${crypto.randomBytes(6).toString('hex')}`;
    const offer = {
      applicationId,
      termMonths,
      apr: term.apr,
      monthlyPayment,
      principal,
    };
    logger.info('financing.mock.prequalify', { ratio: round2(ratio), termMonths });
    if (ratio <= rules.mockRules.approveUpToBudgetRatio) {
      return { status: 'approved', offer, message: 'Pre-approved instantly.' };
    }
    if (ratio <= rules.mockRules.reviewUpToBudgetRatio) {
      return {
        status: 'pending_review',
        offer,
        message: 'This one needs a quick manual review — you can still lock your price today.',
      };
    }
    return {
      status: 'declined',
      reasonCode: 'PAYMENT_EXCEEDS_BUDGET',
      maxMonthlyPayment: round2(statedMonthlyBudget * rules.mockRules.approveUpToBudgetRatio),
      message: 'The monthly payment is above the budget you set. Try a longer term, a different system, or pay in full.',
    };
  }

  async getOffer() {
    throw new AppError(501, 'NOT_IMPLEMENTED', 'Mock lender does not keep offers; call prequalify again.');
  }
}

/**
 * LiveFinancing — drop-in for a real lender API (e.g. a point-of-sale lending
 * partner). Implement the same three methods; routes and UI need no changes.
 */
class LiveFinancing {
  constructor() {
    this.mode = 'live';
  }

  async getTerms() {
    return configStore.getPricingRules().financing.terms;
  }

  async prequalify() {
    throw new AppError(501, 'FINANCING_NOT_CONFIGURED', 'Live lender integration is not wired up yet.');
  }

  async getOffer() {
    throw new AppError(501, 'FINANCING_NOT_CONFIGURED', 'Live lender integration is not wired up yet.');
  }
}

module.exports = { MockFinancing, LiveFinancing };
