'use strict';
/**
 * store — in-memory demo storage. Orders, audit log and processed webhook
 * event IDs live here (on globalThis so module reloads don't wipe them).
 *
 * ⚠️ DEMO ONLY. When a real database is introduced, replace this module
 * (and only the modules listed in the README "Database migration" section).
 */
const crypto = require('crypto');

const g = (globalThis.__airedirect = globalThis.__airedirect || {});
g.orders = g.orders || new Map(); // id -> order
g.audit = g.audit || []; // newest-first, capped
g.webhookEvents = g.webhookEvents || new Set(); // processed Stripe event IDs

const AUDIT_CAP = 500;

function createOrder(fields) {
  const order = {
    id: `ord_${crypto.randomBytes(6).toString('hex')}`,
    status: 'locked',
    createdAt: new Date().toISOString(),
    paidAt: null,
    paymentId: null,
    stripeSessionId: null,
    crmContactId: null,
    crmDealId: null,
    financing: null,
    ...fields,
  };
  g.orders.set(order.id, order);
  return order;
}

function updateOrder(id, patch) {
  const order = g.orders.get(id);
  if (!order) return null;
  Object.assign(order, patch);
  return order;
}

function getOrder(id) {
  return g.orders.get(id) || null;
}

function getOrderByRef(ref) {
  for (const order of g.orders.values()) if (order.ref === ref) return order;
  return null;
}

function listOrders({ status, q } = {}) {
  let out = [...g.orders.values()];
  if (status) out = out.filter((o) => o.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    out = out.filter(
      (o) =>
        o.ref.toLowerCase().includes(needle) ||
        (o.customerEmail || '').toLowerCase().includes(needle) ||
        (o.quote && o.quote.system && `${o.quote.system.brand} ${o.quote.system.name}`.toLowerCase().includes(needle))
    );
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function addAudit(entry) {
  g.audit.unshift({
    id: `aud_${crypto.randomBytes(5).toString('hex')}`,
    ts: new Date().toISOString(),
    ...entry,
  });
  if (g.audit.length > AUDIT_CAP) g.audit.length = AUDIT_CAP;
}

function listAudit({ type, limit = 200 } = {}) {
  let out = g.audit;
  if (type) out = out.filter((e) => e.type === type);
  return out.slice(0, Math.min(limit, AUDIT_CAP));
}

function rememberWebhookEvent(id) {
  if (g.webhookEvents.has(id)) return false;
  g.webhookEvents.add(id);
  if (g.webhookEvents.size > 2000) {
    const first = g.webhookEvents.values().next().value;
    g.webhookEvents.delete(first);
  }
  return true;
}

/** Test helper — wipes everything. Never called from request handlers. */
function _resetForTests() {
  g.orders.clear();
  g.audit.length = 0;
  g.webhookEvents.clear();
}

module.exports = {
  createOrder,
  updateOrder,
  getOrder,
  getOrderByRef,
  listOrders,
  addAudit,
  listAudit,
  rememberWebhookEvent,
  _resetForTests,
};
