'use strict';
/**
 * Single entry point for "a payment succeeded" events, whether they arrive via
 * webhook, the success-page confirmation or the mock card form. Idempotent.
 */
const orders = require('./orders');
const audit = require('./audit');
const log = require('./logger');
const integrations = require('./integrations');
const pricing = require('./pricing');
const configStore = require('./configStore');

const processed = new Set(); // event ids already handled (idempotency)

function expectedDeposit(order) {
  // Re-derive from the signed total; never trust a stored/client "deposit" field.
  return pricing.depositFor(order.quote.totalCents, { depositPercent: order.quote.depositPercent ?? configStore.getPricing().depositPercent });
}

function handleEvent(event, source) {
  if (!event || !event.id) return { handled: false, reason: 'bad_event' };
  if (processed.has(event.id)) return { handled: true, duplicate: true };

  if (event.type !== 'checkout.session.completed') { processed.add(event.id); return { handled: false, reason: 'ignored_type' }; }
  const obj = event.data && event.data.object;
  if (!obj || obj.payment_status !== 'paid') return { handled: false, reason: 'not_paid' };

  const ref = obj.metadata && obj.metadata.ref;
  const order = ref ? orders.get(ref) : null;
  if (!order) { log.warn('payment event for unknown order', { eventId: event.id }); return { handled: false, reason: 'unknown_order' }; }

  if (obj.amount_total !== expectedDeposit(order)) {
    audit.record('payment_mismatch', source, ref, { expected: expectedDeposit(order), received: obj.amount_total, eventId: event.id });
    log.error('payment amount mismatch', { ref });
    return { handled: false, reason: 'amount_mismatch' };
  }

  const { firstTime } = orders.markPaid(ref, { paymentId: obj.id, amountCents: obj.amount_total, provider: order.paymentProvider || source });
  processed.add(event.id);
  if (firstTime) {
    audit.record('payment', source, ref, { amountCents: obj.amount_total, eventId: event.id });
    integrations.onPaymentReceived(order);
  }
  return { handled: true, duplicate: !firstTime };
}

/** For the success-page flow: build a synthetic event id so repeated confirmations are idempotent too. */
function handleConfirmedSession({ id, ref, paid, amountCents }, source) {
  return handleEvent({ id: `confirm_${id}`, type: 'checkout.session.completed', data: { object: { id, payment_status: paid ? 'paid' : 'unpaid', amount_total: amountCents, metadata: { ref } } } }, source);
}

module.exports = { handleEvent, handleConfirmedSession, expectedDeposit };
