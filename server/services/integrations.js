'use strict';
/**
 * Business integrations (CRM, email, SMS). Everything goes through the retry queue,
 * so a failing third party never blocks or fails a customer request.
 */
const adapters = require('../adapters');
const queue = require('./queue');
const config = require('../config');
const { REF_RE } = require('./tokens');

const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function note(order, channel, to) {
  (order.notifications ||= []).push({ ts: new Date().toISOString(), channel, to: channel === 'internal' ? to : '[customer]' });
}

/** Create CRM contact+deal once; safe to call repeatedly (used by both lock and payment jobs). */
async function ensureCrm(order) {
  if (order.crm.dealId) return;
  if (!order.customer) return; // restored-from-token order: nothing to sync
  const r = await adapters.get('crm').createContactAndDeal({ customer: order.customer, order });
  order.crm = { contactId: r.contactId, dealId: r.dealId };
}

function verifyLink(order) {
  return `${config.appUrl}/verify?token=${encodeURIComponent(order.token)}`;
}

function onQuoteLocked(order) {
  if (!REF_RE.test(order.ref) || !order.customer) return;
  const q = order.quote;
  queue.enqueue('crm.createContactAndDeal', () => ensureCrm(order), { ref: order.ref });

  queue.enqueue('email.customerConfirmation', async () => {
    await adapters.get('notifications').sendEmail({
      to: order.customer.email,
      subject: `Your AC price is locked - ${order.ref}`,
      text: [
        `Hi ${order.customer.name},`, '',
        `Your price for the ${q.system.brandName} ${q.system.name} (${q.system.tonnage} ton) is locked at ${money(q.totalCents)} (tax included).`,
        `Reference: ${order.ref}`, `Locked until: ${new Date(order.expiresAt).toDateString()}`,
        `Deposit due to confirm: ${money(q.depositCents)}`, '',
        `Verify your locked price any time: ${verifyLink(order)}`,
      ].join('\n'),
    });
    note(order, 'email', 'customer');
  }, { ref: order.ref });

  if (order.customer.phone) {
    queue.enqueue('sms.customerConfirmation', async () => {
      await adapters.get('notifications').sendSms({ to: order.customer.phone, body: `Your AC price ${money(q.totalCents)} is locked until ${new Date(order.expiresAt).toDateString()}. Ref ${order.ref}. Verify: ${verifyLink(order)}` });
    }, { ref: order.ref });
  }

  queue.enqueue('email.salesNotification', async () => {
    await adapters.get('notifications').sendEmail({
      to: config.salesNotifyEmail,
      subject: `New locked quote ${order.ref} - ${money(q.totalCents)}`,
      text: `A customer locked a quote.\nRef: ${order.ref}\nSystem: ${q.system.brandName} ${q.system.name}\nTotal: ${money(q.totalCents)}\nOpen the Sales dashboard: ${config.appUrl}/sales`,
    });
    note(order, 'internal', 'sales');
  }, { ref: order.ref });
}

function onPaymentReceived(order) {
  const q = order.quote;
  queue.enqueue('crm.updateDealStage', async () => {
    await ensureCrm(order);
    if (order.crm.dealId) await adapters.get('crm').updateDealStage({ dealId: order.crm.dealId, stage: 'deposit_paid' });
  }, { ref: order.ref });

  if (order.customer) {
    queue.enqueue('email.customerReceipt', async () => {
      await adapters.get('notifications').sendEmail({
        to: order.customer.email,
        subject: `Deposit received - ${order.ref}`,
        text: `Thanks ${order.customer.name}! We received your ${money(q.depositCents)} deposit. Your price of ${money(q.totalCents)} stays locked. Reference: ${order.ref}\nVerify: ${verifyLink(order)}`,
      });
    }, { ref: order.ref });
  }
  queue.enqueue('email.salesPaid', async () => {
    await adapters.get('notifications').sendEmail({ to: config.salesNotifyEmail, subject: `Deposit paid ${order.ref}`, text: `Deposit of ${money(q.depositCents)} paid for ${order.ref}. Next step: schedule the install.` });
  }, { ref: order.ref });
}

module.exports = { onQuoteLocked, onPaymentReceived };
