'use strict';
/**
 * email adapter — interface: send({ to, subject, text, html? }) → { id }
 * Live implementation: SendGrid v3 mail/send.
 */
const crypto = require('crypto');
const { AppError } = require('../errors');
const logger = require('../logger');

class MockEmail {
  constructor() {
    this.mode = 'mock';
  }

  async send({ to, subject }) {
    const id = `email_mock_${crypto.randomBytes(5).toString('hex')}`;
    logger.info('email.mock.send', { id, to, subject }); // addresses redacted by logger
    return { id };
  }
}

class SendGridEmail {
  constructor() {
    this.key = process.env.SENDGRID_API_KEY;
    if (!this.key) {
      throw new AppError(500, 'ADAPTER_NOT_CONFIGURED', 'SendGrid is selected but SENDGRID_API_KEY is not set.');
    }
    this.from = process.env.SENDGRID_FROM || 'no-reply@airedirect.example';
    this.mode = 'live';
  }

  async send({ to, subject, text, html }) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.from },
        subject,
        content: [
          { type: 'text/plain', value: text },
          ...(html ? [{ type: 'text/html', value: html }] : []),
        ],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid mail/send → ${res.status}`);
    return { id: res.headers.get('x-message-id') || 'sent' };
  }
}

module.exports = { MockEmail, SendGridEmail };
