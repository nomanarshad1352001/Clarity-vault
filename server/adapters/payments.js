'use strict';
/**
 * payments adapter — interface:
 *   chargeDeposit({ amountCents, card, ref, email })        → mock mode
 *   createDepositCheckout({ amountCents, ref, email, successUrl, cancelUrl }) → live mode
 *   constructWebhookEvent(rawBody, signatureHeader)         → live mode
 *   retrieveSession(sessionId)                              → live mode
 *
 * Amounts ALWAYS come from the server-side price lock — never from the client.
 */
const crypto = require('crypto');
const { AppError } = require('../errors');
const logger = require('../logger');

/** Test-card table (mirrors Stripe's well-known test cards). */
const MOCK_CARDS = {
  success: /^4242/, // 4242 4242 4242 4242
  declined: '4000000000000002',
  insufficient: '4000000000009995',
};

class MockPayments {
  constructor() {
    this.mode = 'mock';
  }

  async chargeDeposit({ amountCents, card }) {
    if (!card) throw new AppError(400, 'CARD_REQUIRED', 'Card details are required.');
    const digits = String(card.number).replace(/\D/g, '');
    if (digits.length < 12 || digits.length > 19) {
      throw new AppError(400, 'CARD_INVALID', 'That card number does not look right.');
    }
    if (digits === MOCK_CARDS.declined) {
      throw new AppError(402, 'CARD_DECLINED', 'Your card was declined. Try a different card.', { declineCode: 'generic_decline' });
    }
    if (digits === MOCK_CARDS.insufficient) {
      throw new AppError(402, 'CARD_DECLINED', 'Insufficient funds. Try a different card.', { declineCode: 'insufficient_funds' });
    }
    if (!MOCK_CARDS.success.test(digits)) {
      throw new AppError(400, 'CARD_INVALID', 'Demo mode: use the test card 4242 4242 4242 4242 (or 4000 0000 0000 0002 to simulate a decline).');
    }
    logger.info('payments.mock.charge', { amountCents, last4: digits.slice(-4) });
    return {
      status: 'succeeded',
      paymentId: `pay_mock_${crypto.randomBytes(8).toString('hex')}`,
      last4: digits.slice(-4),
      brand: 'visa',
    };
  }
}

class StripePayments {
  constructor() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new AppError(500, 'ADAPTER_NOT_CONFIGURED', 'Stripe is selected but STRIPE_SECRET_KEY is not set.');
    }
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    this.stripe = new Stripe(key);
    this.mode = 'live';
  }

  async createDepositCheckout({ amountCents, ref, email, successUrl, cancelUrl }) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents, // computed server-side from the signed lock
            product_data: { name: `Deposit — price lock ${ref}`, description: 'AireDirect installation deposit' },
          },
        },
      ],
      metadata: { ref },
      payment_intent_data: { metadata: { ref } },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    return { checkoutUrl: session.url, sessionId: session.id };
  }

  constructWebhookEvent(rawBody, signatureHeader) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new AppError(500, 'ADAPTER_NOT_CONFIGURED', 'STRIPE_WEBHOOK_SECRET is not set.');
    return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  }

  async retrieveSession(sessionId) {
    return this.stripe.checkout.sessions.retrieve(sessionId);
  }
}

module.exports = { MockPayments, StripePayments };
