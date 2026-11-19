'use strict';
/**
 * In-memory demo order store (lost on restart). The signed lock token is the
 * source of truth for prices, so an order can be re-created from a valid token.
 * Replace with a database table later (see README).
 */
const crypto = require('crypto');

const orders = new Map();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newRef() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `AC-${s}`;
}

function createLocked({ ref, quote, customer, address, financing, lockedAt, expiresAt, token, source }) {
  const order = {
    ref, status: 'locked', quote, customer: customer || null, address: address || null, financing: financing || null,
    lockedAt, expiresAt, token, source: source || 'wizard',
    payment: null, sessionId: null, crm: { contactId: null, dealId: null },
  };
  orders.set(ref, order);
  return order;
}

const get = (ref) => orders.get(ref) || null;

/** If the server restarted, rebuild a minimal order from a verified lock token payload. */
function getOrRestore(payload, token) {
  return get(payload.ref) || createLocked({
    ref: payload.ref, quote: payload.quote, customer: null, address: null, financing: payload.financing || null,
    lockedAt: new Date(payload.iat * 1000).toISOString(), expiresAt: new Date(payload.exp * 1000).toISOString(), token, source: 'restored',
  });
}

function setSession(ref, sessionId, provider) {
  const o = get(ref);
  if (o) { o.sessionId = sessionId; o.paymentProvider = provider; }
}

const findBySession = (sessionId) => [...orders.values()].find((o) => o.sessionId === sessionId) || null;

/** Idempotent. Returns { order, firstTime }. */
function markPaid(ref, { paymentId, amountCents, provider }) {
  const order = get(ref);
  if (!order) return { order: null, firstTime: false };
  if (order.status === 'paid') return { order, firstTime: false };
  order.status = 'paid';
  order.payment = { paymentId, amountCents, provider, paidAt: new Date().toISOString() };
  return { order, firstTime: true };
}

function effectiveStatus(o) {
  if (o.status === 'paid') return 'paid';
  return new Date(o.expiresAt) < new Date() ? 'expired' : 'locked';
}

function list({ status, q, brand, from, to } = {}) {
  const needle = q ? String(q).toLowerCase() : '';
  return [...orders.values()]
    .filter((o) => (status ? effectiveStatus(o) === status : true))
    .filter((o) => (brand ? o.quote.system.brand === brand : true))
    .filter((o) => (from ? new Date(o.lockedAt) >= new Date(from) : true))
    .filter((o) => (to ? new Date(o.lockedAt) <= new Date(`${to}T23:59:59.999Z`) : true))
    .filter((o) => (needle ? [o.ref, o.customer && o.customer.name, o.customer && o.customer.email, o.address && o.address.street, o.quote.zip].filter(Boolean).join(' ').toLowerCase().includes(needle) : true))
    .sort((a, b) => b.lockedAt.localeCompare(a.lockedAt));
}

/** What a homeowner (holder of the token / session id) may see. */
function publicView(o) {
  return {
    ref: o.ref, status: effectiveStatus(o), lockedAt: o.lockedAt, expiresAt: o.expiresAt, quote: o.quote,
    deposit: { amountCents: o.quote.depositCents, paid: o.status === 'paid', paidAt: o.payment ? o.payment.paidAt : null },
    financingStatus: o.financing ? o.financing.status : null,
  };
}

/** Full view for staff dashboards. Never includes the lock token or card data. */
function staffView(o) {
  return {
    ...publicView(o), customer: o.customer, address: o.address, financing: o.financing, payment: o.payment,
    crm: o.crm, source: o.source, notifications: o.notifications || [],
  };
}

function reset() { orders.clear(); }

module.exports = { newRef, createLocked, get, getOrRestore, setSession, findBySession, markPaid, list, publicView, staffView, effectiveStatus, reset };
