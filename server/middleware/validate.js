'use strict';
/**
 * validate — zod-powered request validation. The client never sends a trusted
 * price; every numeric input is range-checked and unknown catalog IDs are
 * rejected in the pricing service.
 */
const { AppError } = require('../errors');

function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.slice(0, 10).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(new AppError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', details));
    }
    req[source === 'body' ? 'body' : source] = result.data;
    return next();
  };
}

module.exports = { validate };
