import assert from 'node:assert/strict';
import test from 'node:test';
import { emailConfigured } from '../src/config.js';

const emailVariables = [
  'EMAIL_SMTP_HOST',
  'EMAIL_SMTP_PORT',
  'EMAIL_SMTP_SECURE',
  'EMAIL_SMTP_USER',
  'EMAIL_SMTP_PASSWORD',
  'EMAIL_FROM',
];

test('email configuration requires username and password together', () => {
  const original = Object.fromEntries(
    emailVariables.map((name) => [name, process.env[name]]),
  );

  try {
    process.env.EMAIL_SMTP_HOST = 'smtp.example.com';
    process.env.EMAIL_SMTP_PORT = '587';
    process.env.EMAIL_FROM = 'tasks@example.com';

    delete process.env.EMAIL_SMTP_USER;
    delete process.env.EMAIL_SMTP_PASSWORD;
    assert.equal(emailConfigured(), true);

    process.env.EMAIL_SMTP_PASSWORD = 'password';
    assert.equal(emailConfigured(), false);

    process.env.EMAIL_SMTP_USER = 'mailer';
    assert.equal(emailConfigured(), true);

    delete process.env.EMAIL_SMTP_PASSWORD;
    assert.equal(emailConfigured(), false);
  } finally {
    for (const name of emailVariables) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});
