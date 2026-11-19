'use strict';
/**
 * sms adapter — interface: send({ to, body }) → { id }
 * Live implementation: Twilio Messages API.
 */
const crypto = require('crypto');
const { AppError } = require('../errors');
const logger = require('../logger');

class MockSms {
  constructor() {
    this.mode = 'mock';
  }

  async send({ to, body }) {
    const id = `sms_mock_${crypto.randomBytes(5).toString('hex')}`;
    logger.info('sms.mock.send', { id, to, length: String(body || '').length });
    return { id };
  }
}

class TwilioSms {
  constructor() {
    this.sid = process.env.TWILIO_ACCOUNT_SID;
    this.token = process.env.TWILIO_AUTH_TOKEN;
    this.from = process.env.TWILIO_FROM_NUMBER;
    if (!this.sid || !this.token || !this.from) {
      throw new AppError(500, 'ADAPTER_NOT_CONFIGURED', 'Twilio is selected but TWILIO_* env vars are missing.');
    }
    this.mode = 'live';
  }

  async send({ to, body }) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: this.from, Body: body }),
    });
    if (!res.ok) throw new Error(`Twilio Messages → ${res.status}`);
    const data = await res.json();
    return { id: data.sid };
  }
}

module.exports = { MockSms, TwilioSms };
