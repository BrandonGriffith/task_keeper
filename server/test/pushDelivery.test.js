import assert from 'node:assert/strict';
import test from 'node:test';
import { sendPendingPushSubscriptions } from '../src/pushDelivery.js';

test('push retries skip subscriptions already recorded as delivered', async () => {
  const subscriptions = [{ _id: 'first' }, { _id: 'second' }];
  const deliveredSubscriptionIds = [];
  const sent = [];
  let failSecond = true;
  const callbacks = {
    send: async (subscription) => {
      sent.push(subscription._id);
      if (subscription._id === 'second' && failSecond) {
        failSecond = false;
        throw new Error('Temporary push failure');
      }
    },
    markDelivered: async (subscriptionId) => deliveredSubscriptionIds.push(subscriptionId),
  };

  await assert.rejects(
    sendPendingPushSubscriptions({ subscriptions, deliveredSubscriptionIds, ...callbacks }),
    /Temporary push failure/,
  );
  await sendPendingPushSubscriptions({ subscriptions, deliveredSubscriptionIds, ...callbacks });

  assert.deepEqual(sent, ['first', 'second', 'second']);
  assert.deepEqual(deliveredSubscriptionIds, ['first', 'second']);
});
