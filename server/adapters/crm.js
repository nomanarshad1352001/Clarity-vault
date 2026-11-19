'use strict';
/**
 * crm adapter — interface:
 *   upsertContact({ email, name })          → { id }
 *   createDeal({ name, amount, stage, contactId, ref }) → { id }
 *   updateDealStage(dealId, stage)          → { id, stage }
 * Live implementation targets the HubSpot v3 CRM API with a private app token.
 */
const crypto = require('crypto');
const { AppError } = require('../errors');
const logger = require('../logger');

class MockCrm {
  constructor() {
    this.mode = 'mock';
  }

  async upsertContact({ email }) {
    const id = `crm_mock_ct_${crypto.randomBytes(5).toString('hex')}`;
    logger.info('crm.mock.upsertContact', { id, email });
    return { id };
  }

  async createDeal({ name, amount, stage }) {
    const id = `crm_mock_deal_${crypto.randomBytes(5).toString('hex')}`;
    logger.info('crm.mock.createDeal', { id, name, amount, stage });
    return { id };
  }

  async updateDealStage(dealId, stage) {
    logger.info('crm.mock.updateDealStage', { dealId, stage });
    return { id: dealId, stage };
  }
}

class HubSpotCrm {
  constructor() {
    this.token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!this.token) {
      throw new AppError(500, 'ADAPTER_NOT_CONFIGURED', 'HubSpot is selected but HUBSPOT_ACCESS_TOKEN is not set.');
    }
    this.mode = 'live';
    this.base = 'https://api.hubapi.com';
  }

  async api(pathname, method, body) {
    const res = await fetch(this.base + pathname, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HubSpot ${method} ${pathname} → ${res.status}`);
    return res.status === 204 ? {} : res.json();
  }

  async upsertContact({ email, name }) {
    const [firstname, ...rest] = String(name || '').split(' ');
    const properties = { email, firstname: firstname || undefined, lastname: rest.join(' ') || undefined };
    try {
      const created = await this.api('/crm/v3/objects/contacts', 'POST', { properties });
      return { id: created.id };
    } catch (err) {
      // 409 → contact exists; find by email and return its id
      const found = await this.api('/crm/v3/objects/contacts/search', 'POST', {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email'],
        limit: 1,
      });
      if (found.results && found.results[0]) return { id: found.results[0].id };
      throw err;
    }
  }

  async createDeal({ name, amount, stage, ref }) {
    const deal = await this.api('/crm/v3/objects/deals', 'POST', {
      properties: { dealname: name, amount: String(amount), dealstage: stage, pipeline: 'default', closedate: null, description: ref },
    });
    return { id: deal.id };
  }

  async updateDealStage(dealId, stage) {
    await this.api(`/crm/v3/objects/deals/${dealId}`, 'PATCH', { properties: { dealstage: stage } });
    return { id: dealId, stage };
  }
}

module.exports = { MockCrm, HubSpotCrm };
