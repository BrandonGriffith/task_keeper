import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import webPush from 'web-push';
import { emailConfigured, pushConfigured } from './config.js';
import { buildDeliveryFailureUpdate, maxDeliveryAttempts } from './deliveryRetry.js';
import { getDatabase, withMongoTransaction } from './db.js';
import { sendPendingPushSubscriptions } from './pushDelivery.js';
import { insertOccurrence, insertScheduleAdjustment } from './occurrences.js';
import {
  missedOccurrenceExpiresAt,
  nextOccurrence,
  occurrenceDateAdjusted,
} from './recurrence.js';
import { invalidateUserReadCache } from './redis.js';

const intervalMs = 15_000;
const missedReminderRepeatMs = 10 * 60 * 1000;
const occurrenceHorizonMs = 7 * 24 * 60 * 60 * 1000;
const schedulerLeaseMs = 2 * 60 * 1000;
let timer;
let activeTick;
let schedulerStopping = false;

function taskSchedule(task) {
  return {
    frequency: task.frequency,
    dueTime: task.dueTime,
    timezone: task.timezone,
    weeklyDay: task.weeklyDay,
    monthlyDay: task.monthlyDay,
    yearlyMonth: task.yearlyMonth,
    yearlyDay: task.yearlyDay,
  };
}

export function missedOccurrenceReminderEligible(occurrence, task, now = new Date()) {
  if (!task) return false;
  const expiresAt = missedOccurrenceExpiresAt(taskSchedule(task), occurrence.dueAt);
  return expiresAt > now;
}

export async function loadOccurrencesForExpiry(occurrences, now) {
  const active = {
    status: { $in: ['missed', 'pending'] },
    supersededAt: { $exists: false },
    dueAt: { $lte: now },
  };
  const expired = await occurrences.find({
    ...active,
    missedExpiresAt: { $lte: now },
  }).sort({ missedExpiresAt: 1, dueAt: 1 }).limit(100).toArray();
  const remaining = 100 - expired.length;
  if (!remaining) return expired;

  const needingRecheck = await occurrences.find({
    ...active,
    $or: [
      { missedExpiresAt: null },
      { missedExpiresAt: { $gt: now } },
    ],
  }).sort({ missedExpiresAt: 1, dueAt: 1 }).limit(remaining).toArray();
  return [...expired, ...needingRecheck];
}

async function createUpcomingOccurrences(changedUserIds) {
  const database = getDatabase();
  const tasks = await database.collection('tasks')
    .find({
      archived: false,
      nextDueAt: { $lte: new Date(Date.now() + occurrenceHorizonMs) },
    })
    .sort({ nextDueAt: 1 })
    .limit(100)
    .toArray();
  const occurrences = database.collection('occurrences');
  const now = Date.now();

  for (const task of tasks) {
    const future = await occurrences.findOne({
      taskId: task._id,
      status: 'pending',
      dueAt: { $gt: new Date(now) },
    });
    if (future) continue;

    const changed = await withMongoTransaction(async (session) => {
      const currentTask = await database.collection('tasks').findOne(
        { _id: task._id, archived: false, nextDueAt: task.nextDueAt },
        { session },
      );
      if (!currentTask) return false;
      const future = await occurrences.findOne(
        {
          taskId: currentTask._id,
          status: 'pending',
          dueAt: { $gt: new Date(now) },
        },
        { session },
      );
      if (future) return false;

      const config = taskSchedule(currentTask);
      let scheduledAt = currentTask.nextDueAt;
      let hasFutureOccurrence = false;
      let iterations = 0;
      while (
        (scheduledAt.getTime() <= now + occurrenceHorizonMs || !hasFutureOccurrence)
        && iterations < 400
      ) {
        const adjusted = occurrenceDateAdjusted(config, scheduledAt);
        const { occurrence, created } = await insertOccurrence(
          currentTask,
          scheduledAt,
          adjusted,
          session,
        );
        await insertScheduleAdjustment(currentTask, occurrence, created, session);
        hasFutureOccurrence = scheduledAt.getTime() > now;
        scheduledAt = nextOccurrence(config, scheduledAt).dueAt;
        iterations += 1;
      }
      await database.collection('tasks').updateOne(
        { _id: currentTask._id, nextDueAt: currentTask.nextDueAt },
        { $set: { nextDueAt: scheduledAt, updatedAt: new Date() } },
        { session },
      );
      return true;
    });
    if (changed) changedUserIds.add(task.userId);
  }
}

export async function ensureNextOpenOccurrence(task, session) {
  const database = getDatabase();
  const occurrences = database.collection('occurrences');
  const future = await occurrences.findOne(
    {
      taskId: task._id,
      status: 'pending',
      dueAt: { $gt: new Date() },
    },
    session ? { session } : {},
  );
  if (future) return;

  const config = taskSchedule(task);
  let scheduledAt = task.nextDueAt;
  let hasFutureOccurrence = false;
  let iterations = 0;
  while (!hasFutureOccurrence && iterations < 400) {
    const adjusted = occurrenceDateAdjusted(config, scheduledAt);
    const { occurrence, created } = await insertOccurrence(task, scheduledAt, adjusted, session);
    await insertScheduleAdjustment(task, occurrence, created, session);
    hasFutureOccurrence = scheduledAt.getTime() > Date.now();
    scheduledAt = nextOccurrence(config, scheduledAt).dueAt;
    iterations += 1;
  }
  if (!hasFutureOccurrence) throw new Error(`Could not find a future occurrence for task ${task._id}`);
  await database.collection('tasks').updateOne(
    { _id: task._id },
    { $set: { nextDueAt: scheduledAt, updatedAt: new Date() } },
    session ? { session } : {},
  );
}

function notificationPreferences(user) {
  return user?.notificationPreferences ?? {
    inAppEnabled: true,
    systemEnabled: true,
    emailEnabled: true,
  };
}

export function buildReminderNotification(
  occurrence,
  task,
  { now = new Date(), repeated = false, inAppEnabled = true } = {},
) {
  return {
    _id: randomUUID(),
    userId: occurrence.userId,
    sourceOccurrenceId: occurrence._id,
    kind: 'reminder',
    title: repeated ? 'Task still missed' : 'Task due',
    body: repeated
      ? `“${task.title}” is still missed. Complete it or snooze it for 30 minutes.`
      : `“${task.title}” is due. Mark it complete or snooze it for 30 minutes.`,
    readAt: inAppEnabled ? null : now,
    createdAt: now,
  };
}

async function insertReminder(occurrence, task, user, session, { repeated = false } = {}) {
  const database = getDatabase();
  const now = new Date();
  const expiresAt = missedOccurrenceExpiresAt(taskSchedule(task), occurrence.dueAt);
  if (expiresAt <= now) return false;
  const preferences = notificationPreferences(user);
  const notification = buildReminderNotification(occurrence, task, {
    now,
    repeated,
    inAppEnabled: preferences.inAppEnabled ?? true,
  });
  const updated = await database.collection('occurrences').findOneAndUpdate(
    {
      _id: occurrence._id,
      status: 'missed',
      supersededAt: { $exists: false },
      snoozedUntil: null,
      missedExpiresAt: expiresAt,
      $expr: { $gt: ['$missedExpiresAt', '$$NOW'] },
    },
    { $set: { lastReminderAt: now } },
    { returnDocument: 'after', ...(session ? { session } : {}) },
  );
  if (!updated) return false;
  await database.collection('notifications').insertOne(
    notification,
    session ? { session } : {},
  );
  const channels = [];
  if (preferences.systemEnabled) channels.push('system');
  if (preferences.emailEnabled) channels.push('email');
  for (const channel of channels) {
    await database.collection('notificationDeliveries').updateOne(
      { notificationId: notification._id, channel },
      {
        $setOnInsert: {
          _id: randomUUID(),
          notificationId: notification._id,
          userId: occurrence.userId,
          channel,
          status: 'pending',
          attempts: 0,
          lastError: null,
          retryAfter: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, ...(session ? { session } : {}) },
    );
  }
  return true;
}

async function createDueReminders(changedUserIds) {
  const database = getDatabase();
  const occurrences = database.collection('occurrences');
  const due = await occurrences.find({
    status: 'pending',
    supersededAt: { $exists: false },
    initialNotifiedAt: null,
    lastReminderAt: null,
    snoozedUntil: null,
    dueAt: { $lte: new Date() },
  }).sort({ dueAt: 1 }).limit(100).toArray();

  for (const occurrence of due) {
    const changed = await withMongoTransaction(async (session) => {
      const task = await database.collection('tasks').findOne({
        _id: occurrence.taskId,
        userId: occurrence.userId,
        archived: false,
      }, { session });
      if (!task) return false;
      const now = new Date();
      if (!missedOccurrenceReminderEligible(occurrence, task, now)) return false;
      const updated = await occurrences.findOneAndUpdate(
        {
          _id: occurrence._id,
          status: 'pending',
          supersededAt: { $exists: false },
          initialNotifiedAt: null,
          snoozedUntil: null,
        },
        {
          $set: {
            status: 'missed',
            missedAt: now,
            initialNotifiedAt: now,
            missedExpiresAt: missedOccurrenceExpiresAt(taskSchedule(task), occurrence.dueAt),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!updated) return false;
      const user = await database.collection('users').findOne(
        { _id: occurrence.userId },
        { session },
      );
      return insertReminder(updated, task, user, session);
    });
    if (changed) changedUserIds.add(occurrence.userId);
  }

  const snoozed = await occurrences.find({
    status: { $in: ['pending', 'missed'] },
    supersededAt: { $exists: false },
    snoozedUntil: { $lte: new Date() },
  }).sort({ snoozedUntil: 1 }).limit(100).toArray();
  for (const occurrence of snoozed) {
    const changed = await withMongoTransaction(async (session) => {
      const task = await database.collection('tasks').findOne({
        _id: occurrence.taskId,
        userId: occurrence.userId,
        archived: false,
      }, { session });
      if (!task) return false;
      const now = new Date();
      if (!missedOccurrenceReminderEligible(occurrence, task, now)) return false;
      const becomesMissed = occurrence.status === 'pending' && !occurrence.initialNotifiedAt;
      const updated = await occurrences.findOneAndUpdate(
        {
          _id: occurrence._id,
          status: { $in: ['pending', 'missed'] },
          supersededAt: { $exists: false },
          snoozedUntil: { $lte: now },
        },
        {
          $set: {
            snoozedUntil: null,
            ...(becomesMissed
              ? {
                status: 'missed',
                missedAt: now,
                initialNotifiedAt: now,
                missedExpiresAt: missedOccurrenceExpiresAt(taskSchedule(task), occurrence.dueAt),
              }
              : {}),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!updated) return false;
      const user = await database.collection('users').findOne(
        { _id: occurrence.userId },
        { session },
      );
      return insertReminder(updated, task, user, session);
    });
    if (changed) changedUserIds.add(occurrence.userId);
  }

  const now = new Date();
  const repeatBefore = new Date(now.getTime() - missedReminderRepeatMs);
  const repeatable = await occurrences.find({
    status: 'missed',
    supersededAt: { $exists: false },
    snoozedUntil: null,
    dueAt: { $lte: now },
    $or: [
      { lastReminderAt: { $lte: repeatBefore } },
      {
        lastReminderAt: { $exists: false },
        initialNotifiedAt: { $lte: repeatBefore },
      },
    ],
  }).sort({ lastReminderAt: 1, initialNotifiedAt: 1 }).limit(100).toArray();

  for (const occurrence of repeatable) {
    const changed = await withMongoTransaction(async (session) => {
      const current = await occurrences.findOne({
        _id: occurrence._id,
        status: 'missed',
        supersededAt: { $exists: false },
        snoozedUntil: null,
        dueAt: { $lte: new Date() },
        $or: [
          { lastReminderAt: { $lte: repeatBefore } },
          {
            lastReminderAt: { $exists: false },
            initialNotifiedAt: { $lte: repeatBefore },
          },
        ],
      }, { session });
      if (!current) return false;
      const task = await database.collection('tasks').findOne({
        _id: current.taskId,
        userId: current.userId,
        archived: false,
      }, { session });
      if (!task) return false;
      if (!missedOccurrenceReminderEligible(current, task, new Date())) return false;
      const user = await database.collection('users').findOne(
        { _id: current.userId },
        { session },
      );
      return insertReminder(current, task, user, session, { repeated: true });
    });
    if (changed) changedUserIds.add(occurrence.userId);
  }
}

async function expireMissedOccurrences(changedUserIds) {
  const database = getDatabase();
  const occurrences = database.collection('occurrences');
  const now = new Date();
  const staleOccurrences = await loadOccurrencesForExpiry(occurrences, now);

  for (const occurrence of staleOccurrences) {
    await withMongoTransaction(async (session) => {
      const task = await database.collection('tasks').findOne({
        _id: occurrence.taskId,
        userId: occurrence.userId,
      }, { session });
      const expectedExpiry = task
        ? missedOccurrenceExpiresAt(taskSchedule(task), occurrence.dueAt)
        : now;
      const storedExpiryFilter = occurrence.missedExpiresAt
        ? { missedExpiresAt: occurrence.missedExpiresAt }
        : { missedExpiresAt: null };
      const filter = {
        _id: occurrence._id,
        status: occurrence.status,
        supersededAt: { $exists: false },
        ...storedExpiryFilter,
      };

      if (expectedExpiry > now) {
        if (occurrence.missedExpiresAt?.getTime() !== expectedExpiry.getTime()) {
          await occurrences.updateOne(
            filter,
            { $set: { missedExpiresAt: expectedExpiry } },
            { session },
          );
        }
        return;
      }

      const expired = await occurrences.updateOne(filter, {
        $set: {
          status: 'missed',
          missedAt: occurrence.status === 'missed'
            ? (occurrence.missedAt ?? now)
            : now,
          missedExpiresAt: expectedExpiry,
          supersededAt: now,
          snoozedUntil: null,
        },
      }, { session });
      if (!expired.modifiedCount) return;

      if (task && !task.archived) {
        const next = nextOccurrence(taskSchedule(task), occurrence.dueAt);
        const inserted = await insertOccurrence(
          task,
          next.dueAt,
          next.dateAdjusted,
          session,
        );
        await insertScheduleAdjustment(task, inserted.occurrence, inserted.created, session);
        const afterNext = nextOccurrence(taskSchedule(task), next.dueAt);
        await database.collection('tasks').updateOne(
          { _id: task._id, userId: task.userId, archived: false },
          {
            $max: { nextDueAt: afterNext.dueAt },
            $set: { updatedAt: now },
          },
          { session },
        );
      }
      changedUserIds.add(occurrence.userId);
    });
  }
}

function emailTransport() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: Number(process.env.EMAIL_SMTP_PORT),
    secure: process.env.EMAIL_SMTP_SECURE === 'true',
    auth: process.env.EMAIL_SMTP_USER
      ? { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASSWORD }
      : undefined,
  });
}

async function sendDelivery(delivery) {
  const database = getDatabase();
  const user = await database.collection('users').findOne({ _id: delivery.userId });
  if (!user) throw new Error('Notification recipient no longer exists');
  const preferences = notificationPreferences(user);
  if (!preferences[delivery.channel === 'email' ? 'emailEnabled' : 'systemEnabled']) return;

  if (delivery.channel === 'email') {
    if (!emailConfigured()) throw new Error('Email SMTP settings are incomplete');
    await emailTransport().sendMail({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: delivery.title,
      text: delivery.body,
    });
    return;
  }

  if (!pushConfigured()) throw new Error('Browser push VAPID keys are not configured');
  const subscriptions = await database.collection('pushSubscriptions')
    .find({ userId: delivery.userId }).toArray();
  const deliveredSubscriptionIds = delivery.deliveredSubscriptionIds ?? [];
  if (!subscriptions.length && !deliveredSubscriptionIds.length) {
    throw new Error('No browser push subscription is registered');
  }
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const payload = JSON.stringify({
    title: delivery.title,
    body: delivery.body,
    url: '/',
    tag: delivery.notificationId,
  });
  await sendPendingPushSubscriptions({
    subscriptions,
    deliveredSubscriptionIds,
    send: async (subscription) => {
      try {
        await webPush.sendNotification(subscription.subscription, payload);
        return true;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await database.collection('pushSubscriptions').deleteOne({ _id: subscription._id });
          return false;
        }
        throw error;
      }
    },
    markDelivered: async (subscriptionId) => {
      const result = await database.collection('notificationDeliveries').updateOne(
        { _id: delivery._id, status: 'sending' },
        {
          $addToSet: { deliveredSubscriptionIds: subscriptionId },
          $set: { updatedAt: new Date() },
        },
      );
      if (!result.matchedCount) {
        throw new Error(`Notification delivery ${delivery._id} is no longer being processed`);
      }
    },
  });
}

async function recordDeliveryFailure(claimed, collection, error, missingConfiguration) {
  const message = error instanceof Error ? error.message : 'Notification delivery failed';
  if (!missingConfiguration) {
    console.error(`Notification delivery ${claimed._id} failed: ${message}`);
  }
  await collection.updateOne(
    { _id: claimed._id, status: 'sending' },
    buildDeliveryFailureUpdate({
      attempts: claimed.attempts,
      errorMessage: message,
      missingConfiguration,
    }),
  );
}

export async function processClaimedDelivery(
  claimed,
  { database, collection, send = sendDelivery },
) {
  let notification;
  try {
    notification = await database.collection('notifications')
      .findOne({ _id: claimed.notificationId });
  } catch (error) {
    await recordDeliveryFailure(claimed, collection, error, false);
    return;
  }

  if (!notification) {
    console.error(`Notification delivery ${claimed._id} has no linked notification; removing it`);
    await collection.deleteOne({ _id: claimed._id, status: 'sending' });
    return;
  }

  try {
    await send({ ...claimed, title: notification.title, body: notification.body });
    await collection.updateOne(
      { _id: claimed._id, status: 'sending' },
      { $set: { status: 'sent', lastError: null, updatedAt: new Date() } },
    );
  } catch (error) {
    const missingConfiguration = claimed.channel === 'email'
      ? !emailConfigured()
      : !pushConfigured();
    await recordDeliveryFailure(claimed, collection, error, missingConfiguration);
  }
}

async function processDeliveryOutbox() {
  const database = getDatabase();
  const collection = database.collection('notificationDeliveries');
  const now = new Date();
  const staleSendingBefore = new Date(now.getTime() - 5 * 60_000);
  const configuredChannels = [
    ...(emailConfigured() ? ['email'] : []),
    ...(pushConfigured() ? ['system'] : []),
  ];
  const deliveries = await collection.find({
    $or: [
      {
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: maxDeliveryAttempts },
        retryAfter: { $lte: now },
      },
      {
        status: 'waiting_for_configuration',
        channel: { $in: configuredChannels },
        attempts: { $lt: maxDeliveryAttempts },
        retryAfter: { $lte: now },
      },
      { status: 'sending', updatedAt: { $lt: staleSendingBefore } },
    ],
  }).sort({ updatedAt: 1 }).limit(50).toArray();

  for (const delivery of deliveries) {
    const stale = delivery.status === 'sending';
    const filter = stale
      ? { _id: delivery._id, status: 'sending', updatedAt: { $lt: staleSendingBefore } }
      : {
        _id: delivery._id,
        status: { $in: ['pending', 'failed', 'waiting_for_configuration'] },
        attempts: { $lt: maxDeliveryAttempts },
        retryAfter: { $lte: now },
      };
    const claimed = await collection.findOneAndUpdate(
      filter,
      { $set: { status: 'sending', updatedAt: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!claimed) continue;

    await processClaimedDelivery(claimed, { database, collection });
  }
}

async function acquireSchedulerLock() {
  const locks = getDatabase().collection('schedulerLocks');
  try {
    await locks.updateOne(
      { _id: 'reminder-scheduler' },
      { $setOnInsert: { leaseUntil: new Date(0) } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const owner = randomUUID();
  const now = new Date();
  const acquired = await locks.updateOne(
    { _id: 'reminder-scheduler', leaseUntil: { $lte: now } },
    { $set: { owner, leaseUntil: new Date(now.getTime() + schedulerLeaseMs) } },
  );
  return acquired.modifiedCount ? owner : null;
}

export async function runSchedulerTick() {
  const database = getDatabase();
  const owner = await acquireSchedulerLock();
  if (!owner) return false;
  const heartbeat = setInterval(() => {
    const now = new Date();
    void database.collection('schedulerLocks').updateOne(
      { _id: 'reminder-scheduler', owner },
      { $set: { leaseUntil: new Date(now.getTime() + schedulerLeaseMs) } },
    ).catch((error) => console.error('Failed to renew reminder scheduler lease', error));
  }, schedulerLeaseMs / 3);
  heartbeat.unref();
  try {
    const changedUserIds = new Set();
    await createUpcomingOccurrences(changedUserIds);
    await expireMissedOccurrences(changedUserIds);
    await createDueReminders(changedUserIds);
    await processDeliveryOutbox();
    await Promise.all([...changedUserIds].map((userId) => invalidateUserReadCache(userId)));
    return true;
  } finally {
    clearInterval(heartbeat);
    await database.collection('schedulerLocks').updateOne(
      { _id: 'reminder-scheduler', owner },
      { $set: { leaseUntil: new Date(0) }, $unset: { owner: '' } },
    );
  }
}

async function safeTick() {
  if (schedulerStopping || activeTick) return;
  activeTick = (async () => {
    try {
      await runSchedulerTick();
    } catch (error) {
      console.error('Reminder scheduler tick failed', error);
    }
  })();
  try {
    await activeTick;
  } finally {
    activeTick = undefined;
  }
}

export function startScheduler() {
  if (timer) return;
  schedulerStopping = false;
  void safeTick();
  timer = setInterval(safeTick, intervalMs);
  timer.unref();
}

export async function stopScheduler() {
  schedulerStopping = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  await activeTick;
}
