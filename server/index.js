'use strict';
/**
 * Standalone entry point — runs the full app (API + static frontend) with
 * plain Express. This is what Docker / Render / Railway should run.
 *
 *   node server/index.js        → http://localhost:4000
 */
require('dotenv').config();
const logger = require('./logger');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 4000);
const app = createApp({ standalone: true });

app.listen(port, () => {
  logger.info('airedirect.listening', { port, mode: 'standalone-express' });
});
