'use strict';
/**
 * Address lookup adapter interface:
 *   suggest(query)   -> [{ id, description }]
 *   details(id)      -> { street, city, state, zip } | null
 * The service-area check is done by the route using config/pricing-rules.json, never by the adapter.
 */
const config = require('../config');
const { request } = require('./http');

const SAMPLE = [
  { street: '1100 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' },
  { street: '2210 S Lamar Blvd', city: 'Austin', state: 'TX', zip: '78704' },
  { street: '4501 Duval St', city: 'Austin', state: 'TX', zip: '78751' },
  { street: '7301 Burnet Rd', city: 'Austin', state: 'TX', zip: '78757' },
  { street: '9012 Research Blvd', city: 'Austin', state: 'TX', zip: '78758' },
  { street: '3300 Manchaca Rd', city: 'Austin', state: 'TX', zip: '78704' },
  { street: '5805 Balcones Dr', city: 'Austin', state: 'TX', zip: '78731' },
  { street: '1200 Main St', city: 'Dallas', state: 'TX', zip: '75202' },
  { street: '800 Travis St', city: 'Houston', state: 'TX', zip: '77002' },
].map((a, i) => ({ id: `mock-${i}`, ...a, description: `${a.street}, ${a.city}, ${a.state} ${a.zip}` }));

const mock = {
  mode: 'mock',
  async suggest(q) {
    const needle = q.toLowerCase();
    return SAMPLE.filter((a) => a.description.toLowerCase().includes(needle)).slice(0, 5).map(({ id, description }) => ({ id, description }));
  },
  async details(id) {
    const a = SAMPLE.find((x) => x.id === id);
    return a ? { street: a.street, city: a.city, state: a.state, zip: a.zip } : null;
  },
};

const KEY = () => ({ 'X-Goog-Api-Key': config.env('GOOGLE_PLACES_API_KEY') });

const live = {
  mode: 'live',
  async suggest(q) {
    const r = await request('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { ...KEY(), 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text' },
      body: { input: q, includedRegionCodes: ['us'], includedPrimaryTypes: ['street_address', 'premise', 'subpremise'] },
    });
    return ((r && r.suggestions) || []).filter((s) => s.placePrediction).slice(0, 5).map((s) => ({ id: s.placePrediction.placeId, description: s.placePrediction.text.text }));
  },
  async details(id) {
    const r = await request(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { headers: { ...KEY(), 'X-Goog-FieldMask': 'addressComponents' } });
    const parts = (r && r.addressComponents) || [];
    const find = (type, short) => { const c = parts.find((p) => p.types && p.types.includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };
    const street = `${find('street_number')} ${find('route')}`.trim();
    const zip = find('postal_code');
    if (!street || !zip) return null;
    return { street, city: find('locality') || find('sublocality'), state: find('administrative_area_level_1', true), zip };
  },
};

const problems = () => ['GOOGLE_PLACES_API_KEY'].filter((k) => !config.env(k));

module.exports = { mock, live, problems };
