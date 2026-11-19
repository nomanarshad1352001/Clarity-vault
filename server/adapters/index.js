'use strict';
/**
 * adapters — factory for all external integrations. Each domain has a "mock"
 * and a "live" implementation; selection is by env var (e.g. PAYMENTS_ADAPTER)
 * with optional in-memory admin override (see configStore.adapterMode).
 *
 * Swapping a mock for a real provider means implementing the same small
 * interface — no route or service code changes.
 */
const configStore = require('../configStore');

const payments = require('./payments');
const financing = require('./financing');
const crm = require('./crm');
const email = require('./email');
const sms = require('./sms');
const address = require('./address');

const factories = {
  payments: { mock: () => new payments.MockPayments(), live: () => new payments.StripePayments() },
  financing: { mock: () => new financing.MockFinancing(), live: () => new financing.LiveFinancing() },
  crm: { mock: () => new crm.MockCrm(), live: () => new crm.HubSpotCrm() },
  email: { mock: () => new email.MockEmail(), live: () => new email.SendGridEmail() },
  sms: { mock: () => new sms.MockSms(), live: () => new sms.TwilioSms() },
  address: { mock: () => new address.MockAddress(), live: () => new address.GooglePlacesAddress() },
};

const g = (globalThis.__airedirect = globalThis.__airedirect || {});
g.adapterInstances = g.adapterInstances || {};
const instances = g.adapterInstances;

function get(domain) {
  const { mode } = configStore.adapterMode(domain);
  const key = `${domain}:${mode}`;
  if (!instances[key]) instances[key] = factories[domain][mode]();
  return instances[key];
}

module.exports = {
  getPayments: () => get('payments'),
  getFinancing: () => get('financing'),
  getCrm: () => get('crm'),
  getEmail: () => get('email'),
  getSms: () => get('sms'),
  getAddress: () => get('address'),
};
