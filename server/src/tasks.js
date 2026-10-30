import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { getDatabase, withMongoTransaction } from './db.js';
import { HttpError } from './errors.js';
import { firstOccurrence, nextOccurrence } from './recurrence.js';
import { ensureNextOpenOccurrence } from './scheduler.js';
import { parseTaskInput } from './validation.js';

const router = Router();

function toApiTask(task, occurrence = null) {
  return {
    id: task._id,
    title: task.title,
    description: task.description,
    frequency: task.frequency,
    due_time: task.dueTime,
    timezone: task.timezone,
    weekly_day: task.weeklyDay ?? null,
    monthly_day: task.monthlyDay ?? null,
    yearly_month: task.yearlyMonth ?? null,
    yearly_day: task.yearlyDay ?? null,
    archived: task.archived,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    next_due_at: task.nextDueAt,
    occurrence_id: occurrence?._id ?? null,
    due_at: occurrence?.dueAt ?? null,
    occurrence_status: occurrence?.status ?? null,
    date_adjusted: occurrence?.dateAdjusted ?? false,
    missed_at: occurrence?.missedAt ?? null,
    completed_at: occurrence?.completedAt ?? null,
    snoozed_until: occurrence?.snoozedUntil ?? null,
  };
}

function toApiOccurrence(occurrence, timezone) {
  return {
    id: occurrence._id,
    task_id: occurrence.taskId,
    title: occurrence.taskTitle,
    timezone,
    due_at: occurrence.dueAt,
    status: occurrence.status,
    date_adjusted: occurrence.dateAdjusted,
    missed_at: occurrence.missedAt ?? null,
    completed_at: occurrence.completedAt ?? null,
  };
}

function taskDocument(userId, input, nextDueAt, existing = {}) {
  const now = new Date();
  return {
    ...existing,
    userId,
    title: input.title,
    description: input.description,
    frequency: input.frequency,
    dueTime: input.dueTime,
    timezone: input.timezone,
    weeklyDay: input.weeklyDay ?? null,
    monthlyDay: input.monthlyDay ?? null,
    yearlyMonth: input.yearlyMonth ?? null,
    yearlyDay: input.yearlyDay ?? null,
    nextDueAt,
    archived: existing.archived ?? false,
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  };
}

async function ownedTask(userId, taskId, session) {
  const task = await getDatabase().collection('tasks').findOne(
    { _id: taskId, userId },
    session ? { session } : {},
  );
  if (!task) throw new HttpError(404, 'Task not found');
  return task;
}

async function deleteOccurrenceNotifications(database, userId, occurrenceIds, session) {
  if (!occurrenceIds.length) return;

  const filter = {
    userId,
    $or: [
      { occurrenceId: { $in: occurrenceIds } },
      { sourceOccurrenceId: { $in: occurrenceIds } },
    ],
  };
  const notifications = database.collection('notifications');
  const linked = await notifications.find(filter, {
    projection: { _id: 1 },
    session,
  }).toArray();
  const notificationIds = linked.map((notification) => notification._id);
  if (!notificationIds.length) return;

  await database.collection('notificationDeliveries').deleteMany(
    { userId, notificationId: { $in: notificationIds } },
    { session },
  );
  await notifications.deleteMany({ _id: { $in: notificationIds }, userId }, { session });
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
    const occurrence = await occurrences.findOne(
      { taskId: task._id, dueAt },
      session ? { session } : {},
    );
    return { occurrence, created: result.upsertedCount === 1 };
  } catch (error) {
    if (session) throw error;
    if (error.code !== 11000) throw error;
    return {
      occurrence: await occurrences.findOne({ taskId: task._id, dueAt }),
      created: false,
    };
  }
}

async function addScheduleAdjustment(task, occurrence, created, session) {
  if (!created || !occurrence.dateAdjusted) return;
  const dateLabel = new Intl.DateTimeFormat('en', {
    timeZone: task.timezone,
    dateStyle: 'long',
  }).format(occurrence.dueAt);
  await getDatabase().collection('notifications').updateOne(
    { occurrenceId: occurrence._id, kind: 'schedule_adjustment' },
    {
      $setOnInsert: {
        _id: randomUUID(),
        userId: task.userId,
        occurrenceId: occurrence._id,
        kind: 'schedule_adjustment',
        title: 'Monthly task date adjusted',
        body: `“${task.title}” is scheduled for ${dateLabel} because the selected day does not exist in that month.`,
        readAt: null,
        createdAt: new Date(),
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  );
}

async function saveTask(userId, taskId, input) {
  const schedule = { ...input };
  const first = firstOccurrence(schedule);
  const next = nextOccurrence(schedule, first.dueAt);
  const database = getDatabase();
  return withMongoTransaction(async (session) => {
    const tasks = database.collection('tasks');
    let task;

    if (taskId) {
      const existing = await ownedTask(userId, taskId, session);
      task = taskDocument(userId, input, next.dueAt, existing);
      await tasks.replaceOne({ _id: taskId, userId }, task, { session });

      const occurrences = database.collection('occurrences');
      const now = new Date();
      await occurrences.updateMany(
        {
          taskId,
          dueAt: { $lte: now },
          status: { $in: ['pending', 'missed'] },
          supersededAt: { $exists: false },
        },
        { $set: { snoozedUntil: null, supersededAt: now } },
        { session },
      );
      const removed = await occurrences.find(
        {
          taskId,
          dueAt: { $gt: now },
          status: { $in: ['pending', 'missed'] },
          supersededAt: { $exists: false },
        },
        { projection: { _id: 1 }, session },
      ).toArray();
      const occurrenceIds = removed.map((occurrence) => occurrence._id);
      if (occurrenceIds.length) {
        await deleteOccurrenceNotifications(database, userId, occurrenceIds, session);
        await occurrences.deleteMany({ _id: { $in: occurrenceIds } }, { session });
      }
    } else {
      task = {
        _id: randomUUID(),
        ...taskDocument(userId, input, next.dueAt),
      };
      await tasks.insertOne(task, { session });
    }

    const { occurrence, created } = await insertOccurrence(
      task,
      first.dueAt,
      first.dateAdjusted,
      session,
    );
    await addScheduleAdjustment(task, occurrence, created, session);
    return task;
  });
}

router.get('/', async (request, response) => {
  const database = getDatabase();
  const archived = request.query.archived === 'true';
  const tasks = await database.collection('tasks')
    .find({ userId: request.user.id, archived })
    .sort({ nextDueAt: 1, createdAt: 1 })
    .toArray();
  if (!tasks.length) return response.json({ tasks: [] });

  const occurrences = await database.collection('occurrences')
    .find({
      userId: request.user.id,
      taskId: { $in: tasks.map((task) => task._id) },
      status: { $in: ['pending', 'missed'] },
      supersededAt: { $exists: false },
    })
    .sort({ dueAt: 1 })
    .toArray();
  const nextByTask = new Map();
  for (const occurrence of occurrences) {
    if (!nextByTask.has(occurrence.taskId)) nextByTask.set(occurrence.taskId, occurrence);
  }
  return response.json({
    tasks: tasks
      .map((task) => toApiTask(task, nextByTask.get(task._id)))
      .sort((left, right) => new Date(left.due_at ?? left.next_due_at) - new Date(right.due_at ?? right.next_due_at)),
  });
});

router.post('/', async (request, response) => {
  const input = parseTaskInput(request.body);
  const task = await saveTask(request.user.id, null, input);
  return response.status(201).json({ task: toApiTask(task) });
});

router.patch('/:id', async (request, response) => {
  const input = parseTaskInput(request.body);
  const task = await saveTask(request.user.id, request.params.id, input);
  return response.json({ task: toApiTask(task) });
});

router.delete('/history', async (request, response) => {
  const database = getDatabase();
  const historyFilter = {
    userId: request.user.id,
    status: { $in: ['completed', 'missed'] },
  };
  await withMongoTransaction(async (session) => {
    const history = await database.collection('occurrences').find(
      historyFilter,
      { projection: { _id: 1 }, session },
    ).toArray();
    await deleteOccurrenceNotifications(
      database,
      request.user.id,
      history.map((occurrence) => occurrence._id),
      session,
    );
    await database.collection('occurrences').deleteMany(historyFilter, { session });
  });
  return response.status(204).end();
});

router.delete('/:id', async (request, response) => {
  const task = await ownedTask(request.user.id, request.params.id);
  if (!task.archived) {
    await getDatabase().collection('tasks').updateOne(
      { _id: task._id, userId: request.user.id },
      { $set: { archived: true, updatedAt: new Date() } },
    );
  }
  return response.status(204).end();
});

router.delete('/:id/permanent', async (request, response) => {
  const database = getDatabase();
  await withMongoTransaction(async (session) => {
    const task = await ownedTask(request.user.id, request.params.id, session);
    if (!task.archived) throw new HttpError(409, 'Archive this task before deleting it permanently');

    const occurrences = database.collection('occurrences');
    const taskOccurrences = await occurrences.find(
      { taskId: task._id, userId: request.user.id },
      { projection: { _id: 1 }, session },
    ).toArray();
    const occurrenceIds = taskOccurrences.map((occurrence) => occurrence._id);
    await deleteOccurrenceNotifications(database, request.user.id, occurrenceIds, session);
    await occurrences.deleteMany({ taskId: task._id, userId: request.user.id }, { session });
    await database.collection('tasks').deleteOne(
      { _id: task._id, userId: request.user.id, archived: true },
      { session },
    );
  });
  return response.status(204).end();
});

router.post('/:id/restore', async (request, response) => {
  const task = await ownedTask(request.user.id, request.params.id);
  if (task.archived) {
    await getDatabase().collection('tasks').updateOne(
      { _id: task._id, userId: request.user.id },
      { $set: { archived: false, updatedAt: new Date() } },
    );
  }
  return response.status(204).end();
});

router.get('/history', async (request, response) => {
  const parsedLimit = Number(request.query.limit ?? 100);
  const parsedOffset = Number(request.query.offset ?? 0);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
    throw new HttpError(400, 'History page size must be between 1 and 200');
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    throw new HttpError(400, 'History offset must be a non-negative integer');
  }

  const database = getDatabase();
  const occurrences = await database.collection('occurrences')
    .find({ userId: request.user.id, status: { $in: ['completed', 'missed'] } })
    .sort({ dueAt: -1, _id: -1 })
    .skip(parsedOffset)
    .limit(parsedLimit)
    .toArray();
  const taskIds = [...new Set(occurrences.map((occurrence) => occurrence.taskId))];
  const tasks = await database.collection('tasks')
    .find({ _id: { $in: taskIds }, userId: request.user.id }, { projection: { _id: 1, timezone: 1 } })
    .toArray();
  const timezones = new Map(tasks.map((task) => [task._id, task.timezone]));
  return response.json({
    occurrences: occurrences.map((occurrence) => (
      toApiOccurrence(occurrence, occurrence.timezone ?? timezones.get(occurrence.taskId))
    )),
    nextOffset: occurrences.length === parsedLimit ? parsedOffset + occurrences.length : null,
  });
});

router.delete('/history/:id', async (request, response) => {
  const database = getDatabase();
  await withMongoTransaction(async (session) => {
    const occurrences = database.collection('occurrences');
    const occurrence = await occurrences.findOne(
      {
        _id: request.params.id,
        userId: request.user.id,
        status: { $in: ['completed', 'missed'] },
      },
      { session },
    );
    if (!occurrence) throw new HttpError(404, 'History entry not found');
    await deleteOccurrenceNotifications(database, request.user.id, [occurrence._id], session);
    await occurrences.deleteOne(
      { _id: occurrence._id, userId: request.user.id },
      { session },
    );
  });
  return response.status(204).end();
});

router.post('/occurrences/:id/complete', async (request, response) => {
  const occurrences = getDatabase().collection('occurrences');
  const now = new Date();
  const updated = await withMongoTransaction(async (session) => {
    const occurrence = await occurrences.findOneAndUpdate(
      {
        _id: request.params.id,
        userId: request.user.id,
        status: { $in: ['pending', 'missed'] },
        supersededAt: { $exists: false },
      },
      { $set: { status: 'completed', completedAt: now, snoozedUntil: null } },
      { returnDocument: 'after', session },
    );
    if (!occurrence) throw new HttpError(404, 'Open task occurrence not found');
    const task = await getDatabase().collection('tasks').findOne({
      _id: occurrence.taskId,
      userId: request.user.id,
      archived: false,
    }, { session });
    if (task) await ensureNextOpenOccurrence(task, session);
    return occurrence;
  });
  return response.json({
    occurrence: {
      id: updated._id,
      task_id: updated.taskId,
      due_at: updated.dueAt,
      status: updated.status,
      date_adjusted: updated.dateAdjusted,
      missed_at: updated.missedAt,
      completed_at: updated.completedAt,
    },
  });
});

router.post('/occurrences/:id/snooze', async (request, response) => {
  const updated = await getDatabase().collection('occurrences').findOneAndUpdate(
    {
      _id: request.params.id,
      userId: request.user.id,
      status: { $in: ['pending', 'missed'] },
      supersededAt: { $exists: false },
    },
    [{
      $set: {
        snoozedUntil: {
          $add: [
            { $max: [{ $ifNull: ['$snoozedUntil', '$$NOW'] }, '$$NOW'] },
            30 * 60_000,
          ],
        },
      },
    }],
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(404, 'Open task occurrence not found');
  return response.json({
    occurrence: { id: request.params.id, snoozed_until: updated.snoozedUntil },
  });
});

export default router;
