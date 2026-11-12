export async function sendPendingPushSubscriptions({
  subscriptions,
  deliveredSubscriptionIds = [],
  send,
  markDelivered,
}) {
  const delivered = new Set(deliveredSubscriptionIds);

  for (const subscription of subscriptions) {
    if (delivered.has(subscription._id)) continue;

    if (await send(subscription) === false) continue;
    await markDelivered(subscription._id);
    delivered.add(subscription._id);
  }
}
