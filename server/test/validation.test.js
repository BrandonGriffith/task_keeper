import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCredentials } from '../src/validation.js';

test('accepts passwords up to bcrypt’s 72-byte input limit', () => {
  assert.doesNotThrow(() => parseCredentials({
    email: 'person@example.com',
    password: 'a'.repeat(72),
  }));
  assert.doesNotThrow(() => parseCredentials({
    email: 'person@example.com',
    password: 'é'.repeat(36),
  }));
});

test('rejects passwords that exceed bcrypt’s 72-byte input limit', () => {
  assert.throws(() => parseCredentials({
    email: 'person@example.com',
    password: 'a'.repeat(73),
  }), /72 UTF-8 bytes/);
  assert.throws(() => parseCredentials({
    email: 'person@example.com',
    password: 'é'.repeat(37),
  }), /72 UTF-8 bytes/);
});
