import assert from 'node:assert/strict';
import test from 'node:test';
import { historyClearFilter, occurrenceCanBeActedOn } from '../src/tasks.js';

test('clearing history keeps unsuperseded missed occurrences actionable', () => {
  assert.deepEqual(historyClearFilter('user-1'), {
    userId: 'user-1',
    $or: [
      { status: 'completed' },
      { status: 'missed', supersededAt: { $exists: true } },
    ],
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
