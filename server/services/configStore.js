'use strict';
/**
 * Loads /config/*.json into memory and persists admin edits back to disk (atomic write).
 * NOTE: on hosts with ephemeral disks (Render/Railway without a volume) edits are lost on redeploy.
 * Replace this module with a DB-backed store later (see README "Replacing modules").
 */
const fs = require('fs');
const path = require('path');
const { catalogSchema, pricingSchema } = require('./schemas');

const DIR = path.join(__dirname, '..', '..', 'config');
const FILES = { catalog: 'catalog.json', pricing: 'pricing-rules.json' };
const SCHEMAS = { catalog: catalogSchema, pricing: pricingSchema };

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const state = { catalog: readJson(FILES.catalog), pricing: readJson(FILES.pricing) };

// Fail fast on a broken config file.
for (const key of Object.keys(state)) {
  const r = SCHEMAS[key].safeParse(state[key]);
  if (!r.success) throw new Error(`Invalid config/${FILES[key]}: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
}

const getCatalog = () => state.catalog;
const getPricing = () => state.pricing;
const getContext = () => ({ catalog: state.catalog, rules: state.pricing });

function diff(a, b, base = '', out = []) {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: base, from: a, to: b });
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diff(a[k], b[k], base ? `${base}.${k}` : k, out);
  return out;
}

/** Validates and (optionally) saves. Returns { changes }. Throws zod error if invalid. */
function update(kind, data, { save }) {
  const parsed = SCHEMAS[kind].parse(data);
  const changes = diff(state[kind], parsed);
  if (save && changes.length) {
    const file = path.join(DIR, FILES[kind]);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n');
    fs.renameSync(tmp, file);
    state[kind] = parsed;
  }
  return { changes };
}

module.exports = { getCatalog, getPricing, getContext, update, diff };
