'use strict';
/**
 * Adapter registry. Each external system has a "mock" and a "live" implementation.
 * The active mode comes from env (PAYMENTS_MODE, FINANCING_MODE, CRM_MODE, NOTIFY_MODE, ADDRESS_MODE)
 * and can be toggled at runtime by an Admin (in memory only - restart returns to the env value).
 */
const config = require('../config');

const defs = {
  payments: require('./payments'),
  financing: require('./financing'),
  crm: require('./crm'),
  notifications: require('./notifications'),
  address: require('./address'),
};

const LABELS = { payments: 'Payments (Stripe Checkout)', financing: 'Financing (lender)', crm: 'CRM (HubSpot)', notifications: 'Email / SMS (SendGrid / Twilio)', address: 'Address lookup (Google Places)' };
const modes = { ...config.modes };

for (const [name, mode] of Object.entries(modes)) {
  if (!['mock', 'live'].includes(mode)) throw new Error(`Invalid mode "${mode}" for adapter ${name}`);
  if (mode === 'live' && defs[name].problems().length) {
    throw new Error(`Adapter ${name} is set to live but is missing: ${defs[name].problems().join(', ')}`);
  }
}

const names = () => Object.keys(defs);
const getMode = (name) => modes[name];
const get = (name) => defs[name][modes[name]];

function setMode(name, mode) {
  if (!defs[name]) return { ok: false, error: 'Unknown adapter' };
  if (!['mock', 'live'].includes(mode)) return { ok: false, error: 'Mode must be mock or live' };
  const missing = mode === 'live' ? defs[name].problems() : [];
  if (missing.length) return { ok: false, error: `Cannot switch to live. Missing env: ${missing.join(', ')}` };
  const from = modes[name];
  modes[name] = mode;
  return { ok: true, from, to: mode };
}

const status = () => names().map((name) => ({ name, label: LABELS[name], mode: modes[name], liveReady: defs[name].problems().length === 0, missingEnv: defs[name].problems() }));
const anyMock = () => names().some((n) => modes[n] === 'mock');

module.exports = { get, getMode, setMode, status, names, anyMock };
