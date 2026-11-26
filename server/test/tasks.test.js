import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompletionUpdate,
  buildHistoryRestoreUpdate,
  buildSnoozeUpdate,
  buildSupersedeOccurrenceUpdate,
  cancelTaskNotificationDeliveries,
  historyClearFilter,
  historyCursorFilter,
  historyDeletionPlan,
  occurrenceCanBeActedOn,
  toApiOccurrence,
} from '../src/tasks.js';

test('history occurrence responses include completion and recorded snooze times', () => {
  const completedAt = new Date('2026-11-17T18:30:00.000Z');
  const snoozeHistory = [
    new Date('2026-11-17T17:00:00.000Z'),
    new Date('2026-11-17T17:30:00.000Z'),
  ];

  assert.deepEqual(toApiOccurrence({
    _id: 'occurrence-1',
    taskId: 'task-1',
    taskTitle: 'Stretch',
    dueAt: new Date('2026-11-17T16:00:00.000Z'),
    status: 'completed',
    dateAdjusted: false,
    completedAt,
    snoozeHistory,
  }, 'America/New_York'), {
    id: 'occurrence-1',
    task_id: 'task-1',
    title: 'Stretch',
    timezone: 'America/New_York',
    due_at: new Date('2026-11-17T16:00:00.000Z'),
    status: 'completed',
    date_adjusted: false,
    missed_at: null,
    completed_at: completedAt,
    snooze_history: snoozeHistory,
  });
});

test('history occurrence responses support records created before snooze tracking', () => {
  assert.deepEqual(toApiOccurrence({
    _id: 'occurrence-1',
    taskId: 'task-1',
    taskTitle: 'Stretch',
    dueAt: new Date('2026-11-17T16:00:00.000Z'),
    status: 'missed',
    dateAdjusted: false,
  }, 'America/New_York').snooze_history, []);
});

test('history cursor continues after the last row in the same due-time group', () => {
  const dueAt = new Date('2026-11-17T16:00:00.000Z');

  assert.deepEqual(historyCursorFilter('user-1', dueAt, 'occurrence-2'), {
    userId: 'user-1',
    status: { $in: ['completed', 'missed'] },
    historyDeletedAt: { $exists: false },
    $or: [
      { dueAt: { $lt: dueAt } },
      { dueAt, _id: { $lt: 'occurrence-2' } },
    ],
  });
});

test('archiving cancels undelivered notifications for the task open occurrences', async () => {
  const calls = [];
  const database = {
    collection(name) {
      if (name === 'occurrences') {
        return {
          find: (filter, options) => {
            calls.push(['occurrences', filter, options]);
            return { toArray: async () => [{ _id: 'occurrence-1' }] };
          },
        };
      }
      if (name === 'notifications') {
        return {
          find: (filter, options) => {
            calls.push(['notifications', filter, options]);
            return { toArray: async () => [{ _id: 'notification-1' }] };
          },
        };
      }
      return {
        updateMany: async (...args) => calls.push(['deliveries', ...args]),
      };
    },
  };
  const session = { id: 'transaction-session' };

  await cancelTaskNotificationDeliveries(database, 'user-1', 'task-1', session);

  assert.deepEqual(calls[0], [
    'occurrences',
    {
      taskId: 'task-1',
      userId: 'user-1',
      status: { $in: ['pending', 'missed'] },
      supersededAt: { $exists: false },
    },
    { projection: { _id: 1 }, session },
  ]);
  assert.equal(calls[1][0], 'notifications');
  assert.equal(calls[2][0], 'deliveries');
  assert.deepEqual(calls[2][1], {
    userId: 'user-1',
    notificationId: { $in: ['notification-1'] },
    status: { $in: ['pending', 'failed', 'waiting_for_configuration', 'sending'] },
  });
  assert.equal(calls[2][2].$set.status, 'cancelled');
  assert.deepEqual(calls[2][3], { session });
});

test('history reads and clears exclude entries already deleted from history', () => {
  assert.deepEqual(historyClearFilter('user-1'), {
    userId: 'user-1',
    status: { $in: ['completed', 'missed'] },
    historyDeletedAt: { $exists: false },
  });
});

test('deleting history hides active missed occurrences without deleting them', () => {
  assert.deepEqual(historyDeletionPlan([
    { _id: 'active-missed', status: 'missed' },
    { _id: 'past-missed', status: 'missed', supersededAt: new Date() },
    { _id: 'closed-missed', status: 'missed', supersededAt: null },
    { _id: 'completed', status: 'completed' },
  ]), {
    retainedOccurrenceIds: ['active-missed'],
    deletedOccurrenceIds: ['past-missed', 'closed-missed', 'completed'],
  });
});

test('snoozing a history-deleted occurrence restores its history and records the snooze', () => {
  const snoozedAt = new Date('2026-11-17T17:00:00.000Z');
  const update = buildSnoozeUpdate(snoozedAt);

  assert.equal(update[0].$set.historyDeletedAt, '$$REMOVE');
  assert.deepEqual(update[0].$set.snoozeHistory, {
    $concatArrays: [
      { $ifNull: ['$snoozeHistory', []] },
      [snoozedAt],
    ],
  });
});

test('completing a history-deleted occurrence restores its history', () => {
  const completedAt = new Date('2026-11-17T17:00:00.000Z');

  assert.deepEqual(buildCompletionUpdate(completedAt), {
    $set: {
      status: 'completed',
      completedAt,
      snoozedUntil: null,
    },
    $unset: { historyDeletedAt: '' },
  });
});

test('history restore and supersede updates clear the deletion marker', () => {
  const supersededAt = new Date('2026-11-17T17:00:00.000Z');

  assert.deepEqual(buildSupersedeOccurrenceUpdate(supersededAt), {
    $set: { snoozedUntil: null, supersededAt },
    $unset: { historyDeletedAt: '' },
  });
  assert.deepEqual(buildHistoryRestoreUpdate(), {
    $unset: { historyDeletedAt: '' },
  });
});

test('missed occurrences are actionable only until expiry', () => {
  const dueAt = new Date('2026-11-12T16:59:00.000Z');
  const timezone = 'America/New_York';

  assert.equal(
    occurrenceCanBeActedOn(
      { status: 'missed', dueAt, missedExpiresAt: new Date('2026-11-13T05:00:00.000Z') },
      timezone,
      new Date('2026-11-13T04:59:59.000Z'),
    ),
    true,
  );
  assert.equal(
    occurrenceCanBeActedOn(
      { status: 'missed', dueAt, missedExpiresAt: new Date('2026-11-13T05:00:00.000Z') },
      timezone,
      new Date('2026-11-13T05:00:00.000Z'),
    ),
    false,
  );
});

test('pending occurrences are not actionable after their scheduled local due day', () => {
  const dueAt = new Date('2026-11-12T16:59:00.000Z');
  const timezone = 'America/New_York';

  assert.equal(
    occurrenceCanBeActedOn(
      { status: 'pending', dueAt },
      timezone,
      new Date('2026-11-13T04:59:59.000Z'),
    ),
    true,
  );
  assert.equal(
    occurrenceCanBeActedOn(
      { status: 'pending', dueAt },
      timezone,
      new Date('2026-11-13T05:00:00.000Z'),
    ),
    false,
  );
});

test('stale missed expiry timestamps do not override the scheduled local-day boundary', () => {
  const dueAt = new Date('2026-11-12T16:59:00.000Z');
  const timezone = 'America/New_York';

  assert.equal(
    occurrenceCanBeActedOn({
      status: 'missed',
      dueAt,
      missedExpiresAt: new Date('2026-11-13T00:00:00.000Z'),
    }, timezone, new Date('2026-11-13T03:44:00.000Z')),
    true,
  );
  assert.equal(
    occurrenceCanBeActedOn({
      status: 'missed',
      dueAt,
      missedExpiresAt: new Date('2026-11-13T08:00:00.000Z'),
    }, timezone, new Date('2026-11-13T05:00:00.000Z')),
    false,
  );
});

test('future occurrences cannot be acted on', () => {
  assert.equal(
    occurrenceCanBeActedOn(
      { status: 'pending', dueAt: new Date('2026-11-18T16:00:00.000Z') },
      'America/New_York',
      new Date('2026-11-17T16:00:00.000Z'),
    ),
    false,
  );
});
