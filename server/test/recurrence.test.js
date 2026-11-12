import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstOccurrence,
  missedOccurrenceExpiresAt,
  nextOccurrence,
  occurrenceDayHasArrived,
} from '../src/recurrence.js';

test('monthly recurrence clamps a selected day to the end of shorter months', () => {
  const occurrence = nextOccurrence({
    frequency: 'monthly',
    timezone: 'UTC',
    dueTime: '09:00',
    monthlyDay: 31,
  }, '2026-01-31T09:00:00.000Z');

  assert.equal(occurrence.dueAt.toISOString(), '2026-02-28T09:00:00.000Z');
  assert.equal(occurrence.dateAdjusted, true);
});

test('daily recurrence keeps its local due hour through a daylight-saving transition', () => {
  const occurrence = nextOccurrence({
    frequency: 'daily',
    timezone: 'America/New_York',
    dueTime: '09:00',
  }, '2026-03-07T14:00:00.000Z');

  assert.equal(occurrence.dueAt.toISOString(), '2026-03-08T13:00:00.000Z');
});

test('a nonexistent spring-forward due time shifts forward by the DST gap', () => {
  const occurrence = firstOccurrence({
    frequency: 'daily',
    timezone: 'America/New_York',
    dueTime: '02:30',
  }, new Date('2026-03-08T05:00:00.000Z'));

  assert.equal(occurrence.dueAt.toISOString(), '2026-03-08T07:30:00.000Z');
});

test('a daily missed occurrence expires at midnight in its schedule timezone', () => {
  const task = {
    frequency: 'daily',
    timezone: 'America/New_York',
    dueTime: '11:59',
  };
  const dueAt = new Date('2026-11-11T16:59:00.000Z');
  const beforeLocalMidnight = new Date('2026-11-12T03:44:00.000Z');
  const staleStoredExpiry = new Date('2026-11-12T00:00:00.000Z');
  const expiresAt = missedOccurrenceExpiresAt(task, dueAt);

  assert.ok(staleStoredExpiry < beforeLocalMidnight);
  assert.equal(expiresAt.toISOString(), '2026-11-12T05:00:00.000Z');
  assert.ok(expiresAt > beforeLocalMidnight);
});

test('missed weekly, monthly, and yearly occurrences expire after their own due day', () => {
  const cases = [
    {
      task: {
        frequency: 'weekly',
        timezone: 'UTC',
        dueTime: '09:00',
        weeklyDay: 2,
      },
      dueAt: '2026-11-10T09:00:00.000Z',
      expectedExpiry: '2026-11-11T00:00:00.000Z',
    },
    {
      task: {
        frequency: 'monthly',
        timezone: 'UTC',
        dueTime: '09:00',
        monthlyDay: 31,
      },
      dueAt: '2026-01-31T09:00:00.000Z',
      expectedExpiry: '2026-02-01T00:00:00.000Z',
    },
    {
      task: {
        frequency: 'yearly',
        timezone: 'UTC',
        dueTime: '09:00',
        yearlyMonth: 11,
        yearlyDay: 12,
      },
      dueAt: '2026-11-12T09:00:00.000Z',
      expectedExpiry: '2026-11-13T00:00:00.000Z',
    },
  ];

  for (const { task, dueAt, expectedExpiry } of cases) {
    assert.equal(
      missedOccurrenceExpiresAt(task, dueAt).toISOString(),
      expectedExpiry,
      `${task.frequency} occurrence should expire after its own due day`,
    );
  }
});

test('an occurrence cannot be completed before its local due day', () => {
  const dueAt = new Date('2026-11-12T16:59:00.000Z');

  assert.equal(
    occurrenceDayHasArrived(
      dueAt,
      'America/New_York',
      new Date('2026-11-12T04:39:00.000Z'),
    ),
    false,
  );
  assert.equal(
    occurrenceDayHasArrived(
      dueAt,
      'America/New_York',
      new Date('2026-11-12T12:00:00.000Z'),
    ),
    true,
  );
  assert.equal(
    occurrenceDayHasArrived(
      dueAt,
      'America/New_York',
      new Date('2026-11-13T04:00:00.000Z'),
    ),
    true,
  );
});
