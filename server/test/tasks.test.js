import assert from 'node:assert/strict';
import test from 'node:test';
import { historyClearFilter } from '../src/tasks.js';

test('clearing history keeps unsuperseded missed occurrences actionable', () => {
  assert.deepEqual(historyClearFilter('user-1'), {
    userId: 'user-1',
    $or: [
      { status: 'completed' },
      { status: 'missed', supersededAt: { $exists: true } },
    ],
  });
});
