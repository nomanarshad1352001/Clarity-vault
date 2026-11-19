'use strict';
/** Tiny JSON logger. Personal data is redacted by key name and by pattern. */
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE_KEYS = /pass|secret|token|authorization|cookie|email|phone|name|address|street|zip|card|cvc|cvv|expiry|signature|api[-_]?key|customer/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS_RE = /\b\d{9,19}\b/g;
const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

function redactString(s) {
  return String(s).replace(JWT_RE, '[JWT]').replace(EMAIL_RE, '[EMAIL]').replace(LONG_DIGITS_RE, '[NUMBER]');
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return '[DEEP]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return redactString(value.message);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.test(k) && v != null && typeof v !== 'boolean' && typeof v !== 'number' ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function write(level, msg, meta) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: redactString(msg), ...(meta ? { meta: redact(meta) } : {}) });
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = {
  redact,
  redactString,
  debug: (m, x) => write('debug', m, x),
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
};
