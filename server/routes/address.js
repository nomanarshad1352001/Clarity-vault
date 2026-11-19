'use strict';
const express = require('express');
const { validate } = require('../middleware/validate');
const { addressCheckSchema } = require('../schemas');
const { asyncWrap } = require('../errors');
const adapters = require('../adapters');

const router = express.Router();

/** Public, rate-limited by the global API limiter. */
router.get(
  '/suggest',
  asyncWrap(async (req, res) => {
    const q = String(req.query.q || '').slice(0, 120);
    const suggestions = await adapters.getAddress().autocomplete(q);
    res.json({ suggestions });
  })
);

router.post(
  '/check',
  validate(addressCheckSchema),
  asyncWrap(async (req, res) => {
    const result = await adapters.getAddress().checkServiceArea(req.body.zip);
    res.json(result);
  })
);

module.exports = router;
