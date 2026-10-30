import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import webPush from 'web-push';
import { emailConfigured, pushConfigured } from './config.js';
import { getDatabase, withMongoTransaction } from './db.js';
import { nextOccurrence, occurrenceDateAdjusted } from './recurrence.js';

const intervalMs = 15_000;
const missedReminderRepeatMs = 10 * 60 * 1000;
const occurrenceHorizonMs = 7 * 24 * 60 * 60 * 1000;
const schedulerLeaseMs = 2 * 60 * 1000;
let timer;
let tickRunning = false;

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

function scheduleAdjustmentBody(task, dueAt) {
  const dateLabel = new Intl.DateTimeFormat('en', {
    timeZone: task.timezone,
    dateStyle: 'long',
  }).format(dueAt);
  return `“${task.title}” is scheduled for ${dateLabel} because the selected day does not exist in that month.`;
}

async function insertOccurrence(task, dueAt, dateAdjusted, session) {
  const occurrences = getDatabase().collection('occurrences');
  const document = {
    _id: randomUUID(),
    taskId: task._id,
    userId: task.userId,
    taskTitle: task.title,
    timezone: task.timezone,
    dueAt,
    status: 'pending',
    dateAdjusted,
    missedAt: null,
    completedAt: null,
    initialNotifiedAt: null,
    lastReminderAt: null,
    snoozedUntil: null,
    createdAt: new Date(),
  };
  try {
    const result = await occurrences.updateOne(
      { taskId: task._id, dueAt },
      { $setOnInsert: document },
      { upsert: true, ...(session ? { session } : {}) },
    );
    return {
      occurrence: await occurrences.findOne(
        { taskId: task._id, dueAt },
        session ? { session } : {},
      ),
      created: result.upsertedCount === 1,
    };
  } catch (error) {
    if (session) throw error;
    if (error.code !== 11000) throw error;
    return {
      occurrence: await occurrences.findOne({ taskId: task._id, dueAt }),
      created: false,
    };
  }
}

async function insertScheduleAdjustment(task, occurrence, created, session) {
  if (!created || !occurrence.dateAdjusted) return;
  await getDatabase().collection('notifications').updateOne(
    { occurrenceId: occurrence._id, kind: 'schedule_adjustment' },
    {
      $setOnInsert: {
        _id: randomUUID(),
        userId: task.userId,
        occurrenceId: occurrence._id,
        kind: 'schedule_adjustment',
        title: 'Monthly task date adjusted',
        body: scheduleAdjustmentBody(task, occurrence.dueAt),
        readAt: null,
        createdAt: new Date(),
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  );
}

async function createUpcomingOccurrences() {
  const database = getDatabase();
  const tasks = await database.collection('tasks')
    .find({ archived: false })
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

    await withMongoTransaction(async (session) => {
      const currentTask = await database.collection('tasks').findOne(
        { _id: task._id, archived: false, nextDueAt: task.nextDueAt },
        { session },
      );
      if (!currentTask) return;
      const future = await occurrences.findOne(
        {
          taskId: currentTask._id,
          status: 'pending',
          dueAt: { $gt: new Date(now) },
        },
        { session },
      );
      if (future) return;

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
    });
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

async function insertReminder(occurrence, task, user, session, { repeated = false } = {}) {
  const database = getDatabase();
  const now = new Date();
  const notification = {
    _id: randomUUID(),
    userId: occurrence.userId,
    sourceOccurrenceId: occurrence._id,
    kind: 'reminder',
    title: repeated ? 'Task still missed' : 'Task due',
    body: repeated
      ? `“${task.title}” is still missed. Complete it or snooze it for 30 minutes.`
      : `“${task.title}” is due. Mark it complete or snooze it for 30 minutes.`,
    readAt: null,
    createdAt: now,
  };
  await database.collection('occurrences').updateOne(
    { _id: occurrence._id, supersededAt: { $exists: false } },
    { $set: { lastReminderAt: now } },
    session ? { session } : {},
  );
  await database.collection('notifications').insertOne(
    notification,
    session ? { session } : {},
  );
  const preferences = notificationPreferences(user);
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
}

async function createDueReminders() {
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
    await withMongoTransaction(async (session) => {
      const task = await database.collection('tasks').findOne({
        _id: occurrence.taskId,
        userId: occurrence.userId,
        archived: false,
      }, { session });
      if (!task) return;
      const now = new Date();
      const updated = await occurrences.findOneAndUpdate(
        {
          _id: occurrence._id,
          status: 'pending',
          supersededAt: { $exists: false },
          initialNotifiedAt: null,
          snoozedUntil: null,
        },
        { $set: { status: 'missed', missedAt: now, initialNotifiedAt: now } },
        { returnDocument: 'after', session },
      );
      if (!updated) return;
      const user = await database.collection('users').findOne(
        { _id: occurrence.userId },
        { session },
      );
      await insertReminder(updated, task, user, session);
    });
  }

  const snoozed = await occurrences.find({
    status: { $in: ['pending', 'missed'] },
    supersededAt: { $exists: false },
    snoozedUntil: { $lte: new Date() },
  }).sort({ snoozedUntil: 1 }).limit(100).toArray();
  for (const occurrence of snoozed) {
    await withMongoTransaction(async (session) => {
      const task = await database.collection('tasks').findOne({
        _id: occurrence.taskId,
        userId: occurrence.userId,
        archived: false,
      }, { session });
      if (!task) return;
      const now = new Date();
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
            ...(occurrence.status === 'pending' && !occurrence.initialNotifiedAt
              ? { status: 'missed', missedAt: now, initialNotifiedAt: now }
              : {}),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!updated) return;
      const user = await database.collection('users').findOne(
        { _id: occurrence.userId },
        { session },
      );
      await insertReminder(updated, task, user, session);
    });
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
    await withMongoTransaction(async (session) => {
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
      if (!current) return;
      const task = await database.collection('tasks').findOne({
        _id: current.taskId,
        userId: current.userId,
        archived: false,
      }, { session });
      if (!task) return;
      const user = await database.collection('users').findOne(
        { _id: current.userId },
        { session },
      );
      await insertReminder(current, task, user, session, { repeated: true });
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
  if (!subscriptions.length) throw new Error('No browser push subscription is registered');
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const payload = JSON.stringify({ title: delivery.title, body: delivery.body, url: '/' });
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(subscription.subscription, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await database.collection('pushSubscriptions').deleteOne({ _id: subscription._id });
      }
      throw error;
    }
  }
}

async function processDeliveryOutbox() {
  const database = getDatabase();
  const collection = database.collection('notificationDeliveries');
  const now = new Date();
  const staleSendingBefore = new Date(now.getTime() - 5 * 60_000);
  const deliveries = await collection.find({
    $or: [
      {
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: 5 },
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
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: 5 },
        retryAfter: { $lte: now },
      };
    const claimed = await collection.findOneAndUpdate(
      filter,
      { $set: { status: 'sending', updatedAt: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!claimed) continue;

    const notification = await database.collection('notifications')
      .findOne({ _id: claimed.notificationId });
    if (!notification) throw new Error(`Notification ${claimed.notificationId} not found`);
    const sendData = { ...claimed, title: notification.title, body: notification.body };
    try {
      await sendDelivery(sendData);
      await collection.updateOne(
        { _id: claimed._id, status: 'sending' },
        { $set: { status: 'sent', lastError: null, updatedAt: new Date() } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification delivery failed';
      const missingConfiguration = claimed.channel === 'email'
        ? !emailConfigured()
        : !pushConfigured();
      if (!missingConfiguration) {
        console.error(`Notification delivery ${claimed._id} failed: ${message}`);
      }
      await collection.updateOne(
        { _id: claimed._id, status: 'sending' },
        {
          $set: {
            status: missingConfiguration ? 'pending' : 'failed',
            retryAfter: new Date(Date.now() + (missingConfiguration ? 5 : 1) * 60_000),
            lastError: message.slice(0, 1000),
            updatedAt: new Date(),
          },
          ...(missingConfiguration ? { $inc: { attempts: -1 } } : {}),
        },
      );
    }
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
    await createUpcomingOccurrences();
    await createDueReminders();
    await processDeliveryOutbox();
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
  if (tickRunning) return;
  tickRunning = true;
  try {
    await runSchedulerTick();
  } catch (error) {
    console.error('Reminder scheduler tick failed', error);
  } finally {
    tickRunning = false;
  }
}

export function startScheduler() {
  if (timer) return;
  void safeTick();
  timer = setInterval(safeTick, intervalMs);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
