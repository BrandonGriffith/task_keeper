import { randomUUID } from 'node:crypto';
import { getDatabase } from './db.js';

export async function insertOccurrence(task, dueAt, dateAdjusted, session) {
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
    snoozeHistory: [],
    createdAt: new Date(),
  };
  const filter = {
    taskId: task._id,
    dueAt,
    status: { $in: ['pending', 'missed'] },
  };

  try {
    const result = await occurrences.updateOne(
      filter,
      { $setOnInsert: document },
      { upsert: true, ...(session ? { session } : {}) },
    );
    return {
      occurrence: await occurrences.findOne(filter, session ? { session } : {}),
      created: result.upsertedCount === 1,
    };
  } catch (error) {
    if (session || error.code !== 11000) throw error;
    return {
      occurrence: await occurrences.findOne(filter),
      created: false,
    };
  }
}

export async function insertScheduleAdjustment(task, occurrence, created, session) {
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
