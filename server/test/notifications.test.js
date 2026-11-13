import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/errors.js';
import { isTrustedPushEndpoint, upsertPushSubscription } from '../src/notifications.js';

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-token',
  keys: { p256dh: 'public-key', auth: 'auth-key' },
};

test('push subscription registration scopes updates to the current account', async () => {
  let update;
  const collection = {
    async updateOne(...args) {
      update = args;
    },
  };
  const now = new Date('2026-01-01T00:00:00.000Z');

  await upsertPushSubscription(collection, 'user-2', subscription, now);

  assert.deepEqual(update[0], { endpoint: subscription.endpoint, userId: 'user-2' });
  assert.deepEqual(update[1].$set, { subscription });
  assert.deepEqual(update[1].$setOnInsert, {
    _id: update[1].$setOnInsert._id,
    userId: 'user-2',
    createdAt: now,
  });
  assert.equal(typeof update[1].$setOnInsert._id, 'string');
  assert.deepEqual(update[2], { upsert: true });
});

test('push subscription registration reports endpoints owned by another account as a conflict', async () => {
  const collection = {
    async updateOne() {
      throw Object.assign(new Error('duplicate endpoint'), { code: 11000 });
    },
  };

  await assert.rejects(
    upsertPushSubscription(collection, 'user-2', subscription),
    (error) => error instanceof HttpError && error.statusCode === 409,
  );
});

test('push subscription endpoints must use an allowed secure notification host', () => {
  assert.equal(isTrustedPushEndpoint(subscription.endpoint), true);
  assert.equal(isTrustedPushEndpoint('http://fcm.googleapis.com/fcm/send/token'), false);
  assert.equal(isTrustedPushEndpoint('https://fcm.googleapis.com.attacker.example/token'), false);
  assert.equal(isTrustedPushEndpoint('https://127.0.0.1/token'), false);
});
