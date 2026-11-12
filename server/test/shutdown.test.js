import assert from 'node:assert/strict';
import test from 'node:test';
import { runCleanupSteps } from '../src/shutdown.js';

test('a cleanup failure does not prevent later resources from closing', async () => {
  const calls = [];
  const failures = [];
  const cleanupSucceeded = await runCleanupSteps([
    { name: 'Redis', run: async () => { calls.push('Redis'); throw new Error('close failed'); } },
    { name: 'MongoDB', run: async () => { calls.push('MongoDB'); } },
  ], (name, error) => failures.push({ name, error: error.message }));

  assert.equal(cleanupSucceeded, false);
  assert.deepEqual(calls, ['Redis', 'MongoDB']);
  assert.deepEqual(failures, [{ name: 'Redis', error: 'close failed' }]);
});

test('successful cleanup reports success', async () => {
  const cleanupSucceeded = await runCleanupSteps([
    { name: 'Redis', run: async () => {} },
    { name: 'MongoDB', run: async () => {} },
  ], () => assert.fail('Unexpected cleanup error'));

  assert.equal(cleanupSucceeded, true);
});

test('shutdown waits for scheduler cleanup before closing the database', async () => {
  const calls = [];
  let releaseScheduler;
  const schedulerStopped = new Promise((resolve) => {
    releaseScheduler = resolve;
  });
  const cleanup = runCleanupSteps([
    { name: 'Scheduler', run: async () => {
      calls.push('Scheduler');
      await schedulerStopped;
    } },
    { name: 'MongoDB', run: async () => calls.push('MongoDB') },
  ], () => assert.fail('Unexpected cleanup error'));

  await Promise.resolve();
  assert.deepEqual(calls, ['Scheduler']);
  releaseScheduler();
  assert.equal(await cleanup, true);
  assert.deepEqual(calls, ['Scheduler', 'MongoDB']);
});
