import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeliveryFailureUpdate, maxDeliveryAttempts } from '../src/deliveryRetry.js';

test('missing configuration waits without consuming a delivery attempt', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const update = buildDeliveryFailureUpdate({
    attempts: 1,
    errorMessage: 'SMTP settings are incomplete',
    missingConfiguration: true,
    now,
  });

  assert.equal(update.$set.status, 'waiting_for_configuration');
  assert.equal(update.$set.retryAfter.toISOString(), '2026-01-01T00:05:00.000Z');
  assert.equal(update.$inc.attempts, -1);
});

test('delivery failures use exponential backoff and cap the attempt count', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const update = buildDeliveryFailureUpdate({
    attempts: maxDeliveryAttempts,
    errorMessage: 'Temporary provider failure',
    missingConfiguration: false,
    now,
  });

  assert.equal(update.$set.status, 'failed');
  assert.equal(update.$set.retryAfter.toISOString(), '2026-01-01T00:16:00.000Z');
  assert.equal(Object.hasOwn(update, '$inc'), false);
});

test('delivery failure details are bounded before storage', () => {
  const update = buildDeliveryFailureUpdate({
    attempts: 1,
    errorMessage: 'x'.repeat(1001),
    missingConfiguration: false,
    now: new Date('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(update.$set.lastError.length, 1000);
});
