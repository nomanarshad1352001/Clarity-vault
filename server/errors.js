'use strict';
/**
 * errors — AppError type, async wrapper, 404 and central error handler.
 * Every API error response shares one shape:
 *   { error: { code, message, details? } }
 */
const logger = require('./logger');

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const asyncWrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large.' } });
  }
  const status = Number.isInteger(err && err.status) ? err.status : 500;
  const code = (err && err.code) || 'INTERNAL';
  const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message;
  if (status >= 500) {
    logger.error('unhandled_error', { code, stack: err && err.stack ? String(err.stack).slice(0, 2000) : undefined });
  } else {
    logger.warn('request_error', { code, status, path: req.originalUrl });
  }
  const body = { error: { code, message } };
  if (err && err.details && status < 500) body.error.details = err.details;
  return res.status(status).json(body);
}

module.exports = { AppError, asyncWrap, notFoundApi, errorHandler };
