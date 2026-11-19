'use strict';
/**
 * Central environment configuration. Reads process.env once at require time.
 * Secrets are never sent to the browser; /api/config only exposes safe flags.
 */
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';
const bool = (v, d = false) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

function requireSecret(name) {
  const v = process.env[name];
  if (v && v.length >= 32) return v;
  if (process.env.REQUIRE_SECRETS === 'true') {
    throw new Error(`${name} must be set to a random string of at least 32 characters`);
  }
  if (!isTest) console.warn(`[config] ${name} missing/short - using an ephemeral random secret (sessions and price-lock tokens will not survive a restart).`);
  return crypto.randomBytes(48).toString('hex');
}

const baseSecret = requireSecret('JWT_SECRET');
const derive = (label) => crypto.createHmac('sha256', baseSecret).update(`derive:${label}`).digest('hex');

const port = int(process.env.PORT, 3000);

const config = {
  isProd,
  isTest,
  port,
  appUrl: (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  trustProxy: process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : false,
  forceHttps: bool(process.env.FORCE_HTTPS, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  demoAutofill: bool(process.env.DEMO_AUTOFILL, true),
  logLevel: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  secrets: {
    session: derive('session'),
    lock: process.env.LOCK_TOKEN_SECRET && process.env.LOCK_TOKEN_SECRET.length >= 32 ? process.env.LOCK_TOKEN_SECRET : derive('price-lock'),
    csrf: derive('csrf'),
    mockWebhook: derive('mock-webhook'),
  },
  sessionHours: int(process.env.SESSION_HOURS, 8),
  modes: {
    payments: process.env.PAYMENTS_MODE || 'mock',
    financing: process.env.FINANCING_MODE || 'mock',
    crm: process.env.CRM_MODE || 'mock',
    notifications: process.env.NOTIFY_MODE || 'mock',
    address: process.env.ADDRESS_MODE || 'mock',
  },
  salesNotifyEmail: process.env.SALES_NOTIFY_EMAIL || 'sales@demo.com',
  queue: {
    maxAttempts: int(process.env.QUEUE_MAX_ATTEMPTS, 5),
    baseDelayMs: int(process.env.QUEUE_BASE_DELAY_MS, 1000),
    maxDelayMs: int(process.env.QUEUE_MAX_DELAY_MS, 60000),
  },
  rate: {
    apiPerMin: int(process.env.RATE_API_PER_MIN, 120),
    quotePerMin: int(process.env.RATE_QUOTE_PER_MIN, 40),
    lockPerMin: int(process.env.RATE_LOCK_PER_MIN, 10),
    loginPer15Min: int(process.env.RATE_LOGIN_PER_15MIN, 10),
    loginLockoutAfter: int(process.env.LOGIN_LOCKOUT_AFTER, 5),
  },
  env: (name, fallback = '') => process.env[name] || fallback,
};

module.exports = config;
