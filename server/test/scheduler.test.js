import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReminderNotification,
  loadOccurrencesForExpiry,
  missedOccurrenceReminderEligible,
} from '../src/scheduler.js';

const task = {
  frequency: 'daily',
  timezone: 'America/New_York',
  dueTime: '11:59',
};

test('reminders created while in-app notifications are disabled are already read', () => {
  const now = new Date('2026-11-12T05:00:00.000Z');
  const occurrence = { _id: 'occurrence-1', userId: 'user-1' };
  const notification = buildReminderNotification(
    occurrence,
    { title: 'Water plants' },
    { now, inAppEnabled: false },
  );

  assert.equal(notification.readAt, now);
  assert.equal(notification.createdAt, now);
});

test('reminders remain unread when in-app notifications are enabled', () => {
  const notification = buildReminderNotification(
    { _id: 'occurrence-1', userId: 'user-1' },
    { title: 'Water plants' },
    { now: new Date('2026-11-12T05:00:00.000Z') },
  );

  assert.equal(notification.readAt, null);
});

test('missed occurrences cannot receive reminders after their local due day expires', () => {
  const dueAt = new Date('2026-11-11T16:59:00.000Z');

  assert.equal(
    missedOccurrenceReminderEligible({
      status: 'missed',
      dueAt,
      missedExpiresAt: new Date('2026-11-12T05:00:00.000Z'),
    }, task, new Date('2026-11-12T05:00:00.000Z')),
    false,
  );
});

test('missed occurrence remains eligible before expiry even if a repeated reminder is due', () => {
  const dueAt = new Date('2026-11-11T16:59:00.000Z');

  assert.equal(
    missedOccurrenceReminderEligible({
      status: 'missed',
      dueAt,
      missedExpiresAt: new Date('2026-11-12T05:00:00.000Z'),
    }, task, new Date('2026-11-12T04:59:59.000Z')),
    true,
  );
});

test('stale stored expiry is ignored in favor of the schedule calculation', () => {
  const dueAt = new Date('2026-11-11T16:59:00.000Z');

  assert.equal(
    missedOccurrenceReminderEligible({
      status: 'missed',
      dueAt,
      missedExpiresAt: new Date('2026-11-12T00:00:00.000Z'),
    }, task, new Date('2026-11-12T03:44:00.000Z')),
    true,
  );
});

test('a pending snoozed occurrence is not marked missed after its due day expires', () => {
  const dueAt = new Date('2026-11-11T16:59:00.000Z');

  assert.equal(
    missedOccurrenceReminderEligible({
      status: 'pending',
      dueAt,
      snoozedUntil: new Date('2026-11-12T05:00:00.000Z'),
    }, task, new Date('2026-11-12T05:00:00.000Z')),
    false,
  );
});

test('expiry batches prioritize rows already past their stored expiry', async () => {
  const now = new Date('2026-11-12T05:00:00.000Z');
  const expired = [{ _id: 'expired' }];
  const needingRecheck = [{ _id: 'still-active' }];
  const queries = [];
  const occurrences = {
    find(filter) {
      const query = { filter };
      queries.push(query);
      return {
        sort(sort) {
          query.sort = sort;
          return this;
        },
        limit(limit) {
          query.limit = limit;
          return this;
        },
        async toArray() {
          return queries.length === 1 ? expired : needingRecheck;
        },
      };
    },
  };

  const result = await loadOccurrencesForExpiry(occurrences, now);

  assert.deepEqual(result, [...expired, ...needingRecheck]);
  assert.deepEqual(queries[0].filter.missedExpiresAt, { $lte: now });
  assert.deepEqual(queries[1].filter.$or, [
    { missedExpiresAt: null },
    { missedExpiresAt: { $gt: now } },
  ]);
  assert.equal(queries[1].limit, 99);
});
