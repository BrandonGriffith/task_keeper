import assert from 'node:assert/strict';
import test from 'node:test';
import {
  historyClearFilter,
  historyDeletionPlan,
  occurrenceCanBeActedOn,
} from '../src/tasks.js';

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
