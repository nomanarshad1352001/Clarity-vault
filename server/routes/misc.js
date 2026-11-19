'use strict';
const express = require('express');
const configStore = require('../configStore');
const store = require('../services/store');
const retryQueue = require('../services/retryQueue');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'airedirect',
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    adapters: Object.fromEntries(configStore.adapterSummary().map((a) => [a.domain, a.mode])),
    orders: store.listOrders({}).length,
    retryQueuePending: retryQueue.pendingCount(),
  });
});

/** Public app config for the frontend chrome (banner, demo autofill, brand). */
router.get('/app-config', (req, res) => {
  res.json({
    brand: { name: 'AireDirect', tagline: 'A new AC, priced online in minutes.' },
    demoBanner: process.env.DEMO_BANNER !== 'false',
    demoAutofill: process.env.DEMO_AUTOFILL === 'true',
    adapters: Object.fromEntries(configStore.adapterSummary().map((a) => [a.domain, a.mode])),
  });
});

module.exports = router;
