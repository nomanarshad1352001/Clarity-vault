'use strict';
/**
 * configStore — loads JSON config files from /config with an in-memory cache.
 * No database anywhere in this project: catalog, pricing rules and demo users
 * all live in versioned JSON files. Admin edits write the file atomically and
 * invalidate the cache.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.cwd(), 'config');
const cache = new Map();

function readJson(name) {
  if (!cache.has(name)) {
    const file = path.join(CONFIG_DIR, name);
    const raw = fs.readFileSync(file, 'utf8');
    cache.set(name, JSON.parse(raw));
  }
  return cache.get(name);
}

function writeJson(name, data) {
  const file = path.join(CONFIG_DIR, name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file); // atomic replace
  cache.set(name, data);
  return data;
}

const getCatalog = () => readJson('catalog.json');
const getPricingRules = () => readJson('pricing-rules.json');
const getDemoUsers = () => readJson('demo-users.json').users;

/* --- Adapter mode selection ------------------------------------------------
 * Source of truth: env vars (PAYMENTS_ADAPTER=mock|live, ...).
 * Admins can toggle at runtime; overrides are in-memory only and reset on
 * restart, so production behavior is always pinned by env. */
const ADAPTER_DOMAINS = ['payments', 'financing', 'crm', 'email', 'sms', 'address'];
const g = (globalThis.__airedirect = globalThis.__airedirect || {});
g.adapterOverrides = g.adapterOverrides || {};

function adapterMode(domain) {
  if (!ADAPTER_DOMAINS.includes(domain)) throw new Error(`Unknown adapter domain: ${domain}`);
  const override = g.adapterOverrides[domain];
  if (override) return { mode: override, source: 'override' };
  const envKey = `${domain.toUpperCase()}_ADAPTER`;
  const mode = (process.env[envKey] || 'mock').toLowerCase();
  return { mode: mode === 'live' ? 'live' : 'mock', source: 'env' };
}

function setAdapterOverride(domain, mode) {
  if (mode === null) delete g.adapterOverrides[domain];
  else g.adapterOverrides[domain] = mode;
}

function adapterSummary() {
  return ADAPTER_DOMAINS.map((domain) => ({ domain, ...adapterMode(domain) }));
}

module.exports = {
  getCatalog,
  getPricingRules,
  getDemoUsers,
  writeJson,
  adapterMode,
  setAdapterOverride,
  adapterSummary,
  ADAPTER_DOMAINS,
};
