import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { emailConfigured, pushConfigured } from './config.js';
import { getDatabase, withMongoTransaction } from './db.js';
import { HttpError } from './errors.js';

const router = Router();
const settingsSchema = z.object({
  inAppEnabled: z.boolean(),
  systemEnabled: z.boolean(),
  emailEnabled: z.boolean(),
});
const directPushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

export function isTrustedPushEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  const trustedHost = directPushHosts.has(endpoint.hostname)
    || endpoint.hostname.endsWith('.notify.windows.com');
  return endpoint.protocol === 'https:'
    && trustedHost
    && (!endpoint.port || endpoint.port === '443');
}

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine(isTrustedPushEndpoint, {
    message: 'Push endpoint must be a supported secure browser notification service',
  }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

function toApiPreferences(preferences = {}) {
  return {
    in_app_enabled: preferences.inAppEnabled ?? true,
    system_enabled: preferences.systemEnabled ?? true,
    email_enabled: preferences.emailEnabled ?? true,
  };
}

router.get('/notifications', async (request, response) => {
  const database = getDatabase();
  const user = await database.collection('users').findOne(
    { _id: request.user.id },
    { projection: { 'notificationPreferences.inAppEnabled': 1 } },
  );
  const enabled = user?.notificationPreferences?.inAppEnabled ?? true;
  const notifications = enabled
    ? await database.collection('notifications')
      .find({ userId: request.user.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()
    : [];
  return response.json({
    notifications: notifications.map((notification) => ({
      id: notification._id,
      occurrence_id: notification.occurrenceId ?? notification.sourceOccurrenceId ?? null,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      read_at: notification.readAt ?? null,
      created_at: notification.createdAt,
    })),
  });
});

router.delete('/notifications', async (request, response) => {
  const database = getDatabase();
  await withMongoTransaction(async (session) => {
    await database.collection('notificationDeliveries').deleteMany(
      { userId: request.user.id },
      { session },
    );
    await database.collection('notifications').deleteMany(
      { userId: request.user.id },
      { session },
    );
  });
  return response.status(204).end();
});

router.patch('/notifications/:id/read', async (request, response) => {
  const notifications = getDatabase().collection('notifications');
  const now = new Date();
  let notification = await notifications.findOneAndUpdate(
    { _id: request.params.id, userId: request.user.id, readAt: null },
    { $set: { readAt: now } },
    { returnDocument: 'after' },
  );
  if (!notification) {
    notification = await notifications.findOne({
      _id: request.params.id,
      userId: request.user.id,
    });
  }
  if (!notification) throw new HttpError(404, 'Notification not found');
  return response.json({
    notification: { id: request.params.id, read_at: notification.readAt },
  });
});

router.delete('/notifications/:id', async (request, response) => {
  const database = getDatabase();
  await withMongoTransaction(async (session) => {
    const notifications = database.collection('notifications');
    const notification = await notifications.findOne(
      { _id: request.params.id, userId: request.user.id },
      { projection: { _id: 1 }, session },
    );
    if (!notification) throw new HttpError(404, 'Notification not found');
    await database.collection('notificationDeliveries').deleteMany(
      { notificationId: notification._id, userId: request.user.id },
      { session },
    );
    await notifications.deleteOne(
      { _id: notification._id, userId: request.user.id },
      { session },
    );
  });
  return response.status(204).end();
});

router.get('/settings/notifications', async (request, response) => {
  const user = await getDatabase().collection('users').findOne(
    { _id: request.user.id },
    { projection: { notificationPreferences: 1 } },
  );
  const preferences = toApiPreferences(user?.notificationPreferences);
  return response.json({
    preferences,
    availability: { inApp: true, system: pushConfigured(), email: emailConfigured() },
    publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null,
  });
});

router.put('/settings/notifications', async (request, response) => {
  const input = settingsSchema.parse(request.body);
  const preferences = {
    inAppEnabled: input.inAppEnabled,
    systemEnabled: input.systemEnabled,
    emailEnabled: input.emailEnabled,
  };
  const result = await getDatabase().collection('users').updateOne(
    { _id: request.user.id },
    { $set: { notificationPreferences: preferences } },
  );
  if (!result.matchedCount) throw new HttpError(404, 'User not found');
  return response.json({ preferences: toApiPreferences(preferences) });
});

router.post('/push-subscriptions', async (request, response) => {
  if (!pushConfigured()) throw new HttpError(503, 'Browser push is not configured on the server');
  const input = subscriptionSchema.parse(request.body);
  const now = new Date();
  await getDatabase().collection('pushSubscriptions').updateOne(
    { endpoint: input.endpoint },
    {
      $set: { userId: request.user.id, subscription: input },
      $setOnInsert: { _id: randomUUID(), createdAt: now },
    },
    { upsert: true },
  );
  return response.status(201).json({ subscribed: true });
});

router.delete('/push-subscriptions', async (request, response) => {
  const parsed = z.object({ endpoint: z.string().url().max(2048) }).parse(request.body);
  await getDatabase().collection('pushSubscriptions').deleteOne({
    userId: request.user.id,
    endpoint: parsed.endpoint,
  });
  return response.status(204).end();
});

export default router;
