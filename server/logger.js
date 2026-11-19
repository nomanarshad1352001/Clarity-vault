'use strict';
/**
 * logger — structured JSON logs to stdout with personal data redacted.
 * Redaction is key-based (password, card numbers, tokens, emails, ...) plus a
 * value scan for JWT-shaped strings, so secrets never hit the log stream.
 */
const REDACT_KEYS = new Set([
  'password', 'passwordhash', 'card', 'cardnumber', 'cvc', 'cvv', 'exp',
  'token', 'locktoken', 'csrftoken', 'authorization', 'cookie', 'email',
  'phone', 'address', 'street', 'ssn', 'apikey', 'secret',
]);
const JWT_SHAPE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return value.replace(JWT_SHAPE, '[redacted-jwt]');
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level, msg, meta) {
  const line = { ts: new Date().toISOString(), level, msg };
  if (meta !== undefined) line.meta = redact(meta);
  const sink = level === 'error' ? process.stderr : process.stdout;
  sink.write(JSON.stringify(line) + '\n');
}

module.exports = {
  redact,
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  debug: (msg, meta) => {
    if (process.env.NODE_ENV !== 'production') write('debug', msg, meta);
  },
};
