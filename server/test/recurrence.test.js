import assert from 'node:assert/strict';
import test from 'node:test';
import { firstOccurrence, nextOccurrence } from '../src/recurrence.js';

test('preserves local due time across a daylight-saving spring-forward gap', () => {
  const config = {
    frequency: 'daily',
    dueTime: '02:30',
    timezone: 'America/New_York',
  };
  const previous = new Date('2024-03-09T07:30:00.000Z');

  assert.equal(
    nextOccurrence(config, previous).dueAt.toISOString(),
    '2024-03-10T07:30:00.000Z',
  );
});

test('keeps scheduled local time on a normal day', () => {
  const config = {
    frequency: 'daily',
    dueTime: '08:15',
    timezone: 'America/New_York',
  };

  assert.equal(
    firstOccurrence(config, new Date('2024-03-09T12:00:00.000Z')).dueAt.toISOString(),
    '2024-03-09T13:15:00.000Z',
  );
});
