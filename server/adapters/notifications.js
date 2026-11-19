'use strict';
/**
 * Notification adapter interface:
 *   sendEmail({ to, subject, text }) -> void
 *   sendSms({ to, body })            -> void   (live: skipped silently if Twilio is not configured)
 */
const config = require('../config');
const { request, shouldMockFail } = require('./http');

const outbox = [];
const push = (m) => { outbox.push({ ts: new Date().toISOString(), ...m }); if (outbox.length > 100) outbox.shift(); };

const mock = {
  mode: 'mock',
  outbox: () => outbox.slice().reverse(),
  async sendEmail({ to, subject, text }) {
    if (shouldMockFail()) throw new Error('Mock email random failure');
    push({ channel: 'email', to, subject, body: text });
  },
  async sendSms({ to, body }) {
    if (shouldMockFail()) throw new Error('Mock SMS random failure');
    push({ channel: 'sms', to, subject: null, body });
  },
};

const live = {
  mode: 'live',
  outbox: () => [],
  async sendEmail({ to, subject, text }) {
    await request('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${config.env('SENDGRID_API_KEY')}` },
      body: { personalizations: [{ to: [{ email: to }] }], from: { email: config.env('SENDGRID_FROM_EMAIL') }, subject, content: [{ type: 'text/plain', value: text }] },
    });
  },
  async sendSms({ to, body }) {
    const sid = config.env('TWILIO_ACCOUNT_SID'); const token = config.env('TWILIO_AUTH_TOKEN'); const from = config.env('TWILIO_FROM_NUMBER');
    if (!sid || !token || !from) return;
    await request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST', form: true, headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
      body: { To: to, From: from, Body: body },
    });
  },
};

const problems = () => ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'].filter((k) => !config.env(k));

module.exports = { mock, live, problems };
