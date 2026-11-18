import assert from 'node:assert/strict';
import test from 'node:test';
import {
  historyClearFilter,
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
