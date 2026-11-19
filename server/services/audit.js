'use strict';
/** In-memory audit log (capped). Details are redacted before storing. */
const { redact } = require('./logger');

const MAX = 2000;
const entries = [];
let seq = 0;

function record(type, actor, ref, details) {
  const entry = { id: ++seq, ts: new Date().toISOString(), type, actor: actor || 'system', ref: ref || null, details: redact(details || {}) };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  return entry;
}

function list({ type, limit = 200 } = {}) {
  const rows = type ? entries.filter((e) => e.type === type) : entries;
  return rows.slice(-limit).reverse();
}

function clear() { entries.length = 0; }

module.exports = { record, list, clear };
