'use strict';
/**
 * integrations — fan-out of business events to external systems (CRM, email,
 * SMS) through the adapter layer + retry queue. Everything here is fire-and-
 * forget from the request's point of view.
 */
const adapters = require('../adapters');
const retryQueue = require('./retryQueue');
const logger = require('../logger');

function baseUrl() {
  return (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function onQuoteLocked(order, lockToken) {
  const verifyUrl = `${baseUrl()}/verify?token=${encodeURIComponent(lockToken)}`;

  retryQueue.enqueue('crm.contact+deal', async () => {
    const crm = adapters.getCrm();
    const contact = await crm.upsertContact({ email: order.customerEmail, name: order.customerName });
    const deal = await crm.createDeal({
      name: `Price lock ${order.ref}`,
      amount: order.quote.total,
      stage: 'quote_locked',
      contactId: contact.id,
      ref: order.ref,
    });
    store_update(order, { crmContactId: contact.id, crmDealId: deal.id });
  }, { ref: order.ref });

  retryQueue.enqueue('email.quoteLocked', async () => {
    const email = adapters.getEmail();
    await email.send({
      to: order.customerEmail,
      subject: `Your price is locked — ${order.ref}`,
      text: [
        `Hi ${order.customerName || 'there'},`,
        ``,
        `Your new ${order.quote.system.brand} ${order.quote.system.name} is locked at $${order.quote.total.toFixed(2)}.`,
        `This price is guaranteed until ${new Date(order.lockExpiresAt).toDateString()}.`,
        ``,
        `Verify your locked price any time: ${verifyUrl}`,
        `Reference: ${order.ref}`,
      ].join('\n'),
    });
    const salesTo = process.env.SALES_NOTIFY_EMAIL;
    if (salesTo) {
      await email.send({
        to: salesTo,
        subject: `[Sales] New locked quote ${order.ref}`,
        text: `Quote ${order.ref} locked for $${order.quote.total.toFixed(2)} (${order.quote.system.brand} ${order.quote.system.name}). Customer: ${order.customerEmail}.`,
      });
    }
  }, { ref: order.ref });

  retryQueue.enqueue('sms.quoteLocked', async () => {
    const sms = adapters.getSms();
    await sms.send({
      to: order.customerPhone || '+15550000000',
      body: `AireDirect: price locked at $${order.quote.total.toFixed(2)} until ${new Date(order.lockExpiresAt).toDateString()}. Ref ${order.ref}. Verify: ${verifyUrl}`,
    });
  }, { ref: order.ref });
}

function onPaymentSucceeded(order) {
  retryQueue.enqueue('crm.dealStage', async () => {
    if (!order.crmDealId) return;
    const crm = adapters.getCrm();
    await crm.updateDealStage(order.crmDealId, 'deposit_paid');
  }, { ref: order.ref });

  retryQueue.enqueue('email.depositPaid', async () => {
    const email = adapters.getEmail();
    await email.send({
      to: order.customerEmail,
      subject: `Deposit received — ${order.ref}`,
      text: `We've received your $${order.quote.deposit.toFixed(2)} deposit. Your install team will reach out within one business day to schedule. Reference: ${order.ref}.`,
    });
    const salesTo = process.env.SALES_NOTIFY_EMAIL;
    if (salesTo) {
      await email.send({
        to: salesTo,
        subject: `[Sales] Deposit paid ${order.ref}`,
        text: `Deposit of $${order.quote.deposit.toFixed(2)} paid on ${order.ref}.`,
      });
    }
  }, { ref: order.ref });
}

// Late require to avoid a cycle: store ← retryQueue ← integrations
const store = require('./store');
function store_update(order, patch) {
  store.updateOrder(order.id, patch);
}

logger.debug('integrations module loaded');
module.exports = { onQuoteLocked, onPaymentSucceeded };
