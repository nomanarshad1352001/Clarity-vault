'use strict';
const { ZodError } = require('zod');
const { PricingError } = require('../services/pricing');
const { TokenError } = require('../services/tokens');
const { formatIssues } = require('../services/schemas');
const log = require('../services/logger');

/** Wrap async route handlers so rejected promises reach the error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFoundApi(req, res) {
  res.status(404).json({ error: 'not_found', message: 'Unknown API endpoint' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ZodError) return res.status(400).json({ error: 'validation_error', message: 'Please check the highlighted fields.', details: formatIssues(err) });
  if (err instanceof PricingError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err instanceof TokenError) return res.status(err.code === 'expired' ? 410 : 400).json({ error: `token_${err.code}`, message: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Request body too large' });
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) log.error('unhandled error', { path: req.path, error: err.message });
  // Never leak internals or stack traces to clients.
  res.status(status).json({ error: status >= 500 ? 'server_error' : 'error', message: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
}

module.exports = { wrap, notFoundApi, errorHandler };
