'use strict';
/**
 * address adapter — interface:
 *   autocomplete(query)     → [{ label, street, zip }]
 *   checkServiceArea(zip)   → { serviceable, message }   (always enforced from
 *                                                          local config, even in
 *                                                          live mode)
 * Live implementation: Google Places Autocomplete (New).
 */
const configStore = require('../configStore');
const { AppError } = require('../errors');

function serviceAreaCheck(zip) {
  const rules = configStore.getPricingRules();
  if (rules.serviceAreaZips.includes(zip)) {
    return { serviceable: true, message: `Good news — we install in ${rules.serviceAreaLabel}.` };
  }
  return {
    serviceable: false,
    message: `We're not in ${zip} yet. We currently serve ${rules.serviceAreaLabel} — join the waitlist and we'll reach out when we expand.`,
  };
}

class MockAddress {
  constructor() {
    this.mode = 'mock';
  }

  async autocomplete(query) {
    const q = String(query || '').trim();
    if (q.length < 3) return [];
    const rules = configStore.getPricingRules();
    const streets = ['Maple Ave', 'Oak Lawn Dr', 'Cedar Springs Rd', 'Elm St', 'Pecan Ridge Ln', 'Mockingbird Ln'];
    const zips = rules.serviceAreaZips;
    const seed = [...q].reduce((a, c) => a + c.charCodeAt(0), 0);
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const num = 100 + ((seed * (i + 3)) % 8900);
      const street = streets[(seed + i) % streets.length];
      const zip = zips[(seed + i * 7) % zips.length];
      out.push({ label: `${num} ${street}, Dallas, TX ${zip}`, street: `${num} ${street}`, zip });
    }
    return out;
  }

  async checkServiceArea(zip) {
    return serviceAreaCheck(zip);
  }
}

class GooglePlacesAddress {
  constructor() {
    this.key = process.env.GOOGLE_PLACES_API_KEY;
    if (!this.key) {
      throw new AppError(500, 'ADAPTER_NOT_CONFIGURED', 'Google Places is selected but GOOGLE_PLACES_API_KEY is not set.');
    }
    this.mode = 'live';
  }

  async autocomplete(query) {
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.key },
      body: JSON.stringify({ input: String(query || ''), includedRegionCodes: ['us'] }),
    });
    if (!res.ok) throw new Error(`Places autocomplete → ${res.status}`);
    const data = await res.json();
    return (data.suggestions || [])
      .filter((s) => s.placePrediction)
      .slice(0, 5)
      .map((s) => ({
        label: s.placePrediction.text.text,
        street: s.placePrediction.structuredFormat?.mainText?.text || s.placePrediction.text.text,
        zip: (s.placePrediction.text.text.match(/\b\d{5}\b/) || [null])[0],
      }));
  }

  async checkServiceArea(zip) {
    return serviceAreaCheck(zip);
  }
}

module.exports = { MockAddress, GooglePlacesAddress };
