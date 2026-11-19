'use strict';
const config = require('./config');
const log = require('./services/logger');
const adapters = require('./adapters');
const { createApp } = require('./app');

const app = createApp();
const server = app.listen(config.port, () => {
  log.info(`AC quote server listening on :${config.port}`, { env: config.isProd ? 'production' : 'development' });
  log.info('adapter modes', Object.fromEntries(adapters.names().map((n) => [n, adapters.getMode(n)])));
  if (config.isProd && config.demoAutofill) log.warn('DEMO_AUTOFILL=true in production - demo credentials are exposed. Set DEMO_AUTOFILL=false and replace config/demo-users.json before go-live.');
});

function shutdown(signal) {
  log.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandledRejection', { error: err && err.message }));
