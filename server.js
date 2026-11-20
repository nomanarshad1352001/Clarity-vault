'use strict';
/**
 * Vercel entrypoint. Its Express preset looks for a root-level app/index/server file
 * and deploys the exported Express app as a single function.
 *
 * Local development/production still uses `npm start` -> server/index.js, which
 * calls app.listen(). Do not listen on a port here: Vercel invokes the export.
 */
const express = require('express'); // explicit so Vercel's Express detection is unambiguous
const { createApp } = require('./server/app');

module.exports = createApp();
