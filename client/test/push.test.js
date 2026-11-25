import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationServerKeyFromBase64Url,
  removeCurrentPushSubscription,
} from '../src/push.js';

test('VAPID public keys decode from unpadded base64url', () => {
  assert.deepEqual(
    applicationServerKeyFromBase64Url('AQIDBA'),
    new Uint8Array([1, 2, 3, 4]),
  );
  assert.deepEqual(
    applicationServerKeyFromBase64Url('-_8'),
    new Uint8Array([0xfb, 0xff]),
  );
});

test('push subscription is removed from the account before unsubscribing the browser', async () => {
  const calls = [];
  const serviceWorkerContainer = {
    getRegistration: async () => ({
      pushManager: {
        getSubscription: async () => ({
          endpoint: 'https://push.example.test/subscription',
          unsubscribe: async () => {
            calls.push('unsubscribe');
            return true;
          },
        }),
      },
    }),
  };

  await removeCurrentPushSubscription(serviceWorkerContainer, async (endpoint) => {
    calls.push(`remove:${endpoint}`);
  });

  assert.deepEqual(calls, [
    'remove:https://push.example.test/subscription',
    'unsubscribe',
  ]);
});

test('push cleanup is a no-op when this browser has no subscription', async () => {
  let removeCalled = false;
  const result = await removeCurrentPushSubscription({
    getRegistration: async () => undefined,
  }, async () => {
    removeCalled = true;
  });

  assert.equal(result, false);
  assert.equal(removeCalled, false);
});
