'use strict';
/**
 * CRM adapter interface:
 *   createContactAndDeal({ customer, order }) -> { contactId, dealId }
 *   updateDealStage({ dealId, stage })        -> void     (stage: 'quote_locked' | 'deposit_paid')
 */
const config = require('../config');
const { request, shouldMockFail } = require('./http');

let seq = 1;
const mockStore = { contacts: [], deals: [] };

const mock = {
  mode: 'mock',
  store: mockStore,
  async createContactAndDeal({ customer, order }) {
    if (shouldMockFail()) throw new Error('Mock CRM random failure');
    const contactId = `mock-contact-${seq}`; const dealId = `mock-deal-${seq++}`;
    mockStore.contacts.push({ id: contactId, email: customer.email });
    mockStore.deals.push({ id: dealId, contactId, ref: order.ref, amountCents: order.quote.totalCents, stage: 'quote_locked' });
    return { contactId, dealId };
  },
  async updateDealStage({ dealId, stage }) {
    if (shouldMockFail()) throw new Error('Mock CRM random failure');
    const d = mockStore.deals.find((x) => x.id === dealId);
    if (!d) throw new Error('Deal not found');
    d.stage = stage;
  },
};

const API = 'https://api.hubapi.com';
const auth = () => ({ Authorization: `Bearer ${config.env('HUBSPOT_ACCESS_TOKEN')}` });
const stageId = (stage) => (stage === 'deposit_paid' ? config.env('HUBSPOT_STAGE_PAID', 'closedwon') : config.env('HUBSPOT_STAGE_LOCKED', 'appointmentscheduled'));

const live = {
  mode: 'live',
  async createContactAndDeal({ customer, order }) {
    const [first, ...rest] = String(customer.name).split(' ');
    let contactId;
    try {
      const c = await request(`${API}/crm/v3/objects/contacts`, { method: 'POST', headers: auth(), body: { properties: { email: customer.email, firstname: first, lastname: rest.join(' ') || '-', phone: customer.phone || '' } } });
      contactId = c.id;
    } catch (err) {
      // 409 = contact already exists; HubSpot returns "Existing ID: 123" in the message.
      const m = err.status === 409 && /Existing ID:\s*(\d+)/.exec(String(err.data && err.data.message));
      if (!m) throw err;
      contactId = m[1];
    }
    const d = await request(`${API}/crm/v3/objects/deals`, {
      method: 'POST', headers: auth(),
      body: {
        properties: { dealname: `AC replacement ${order.ref}`, amount: (order.quote.totalCents / 100).toFixed(2), dealstage: stageId('quote_locked'), pipeline: config.env('HUBSPOT_PIPELINE', 'default') },
        associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }],
      },
    });
    return { contactId, dealId: d.id };
  },
  async updateDealStage({ dealId, stage }) {
    await request(`${API}/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, { method: 'PATCH', headers: auth(), body: { properties: { dealstage: stageId(stage) } } });
  },
};

const problems = () => ['HUBSPOT_ACCESS_TOKEN'].filter((k) => !config.env(k));

module.exports = { mock, live, problems };
