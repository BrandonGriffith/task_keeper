import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/errors.js';
import { parseCredentials, parseTaskInput } from '../src/validation.js';

const dailyTask = {
  title: '  Stretch  ',
  frequency: 'daily',
  dueTime: '09:30',
  timezone: 'America/New_York',
};

function assertHttpError(callback, message) {
  assert.throws(callback, (error) => (
    error instanceof HttpError
    && error.statusCode === 400
    && error.message === message
  ));
}

test('credentials trim and normalize email addresses', () => {
  assert.deepEqual(parseCredentials({
    email: '  User@Example.com ',
    password: 'a secure password',
  }), {
    email: 'user@example.com',
    password: 'a secure password',
  });
});

test('credentials enforce the minimum password length', () => {
  assert.throws(() => parseCredentials({
    email: 'user@example.com',
    password: '123456789',
  }));
});

test('credentials enforce bcrypt byte limits for multibyte passwords', () => {
  assert.equal(parseCredentials({
    email: 'user@example.com',
    password: 'é'.repeat(36),
  }).password, 'é'.repeat(36));

  assert.throws(() => parseCredentials({
    email: 'user@example.com',
    password: 'é'.repeat(37),
  }));
});

test('credentials reject malformed or overlong email addresses', () => {
  for (const email of ['not-an-email', `${'a'.repeat(245)}@example.com`]) {
    assert.throws(() => parseCredentials({ email, password: 'long-enough-password' }));
  }
});

test('daily task input trims the title and defaults the description', () => {
  assert.deepEqual(parseTaskInput(dailyTask), {
    title: 'Stretch',
    description: '',
    frequency: 'daily',
    dueTime: '09:30',
    timezone: 'America/New_York',
  });
});

test('task input rejects blank or oversized titles and invalid due times', () => {
  for (const title of ['   ', 'x'.repeat(121)]) {
    assert.throws(() => parseTaskInput({ ...dailyTask, title }));
  }
  for (const dueTime of ['9:30', '24:00', '12:60']) {
    assert.throws(() => parseTaskInput({ ...dailyTask, dueTime }));
  }
});

test('weekly tasks require a weekday in the supported range', () => {
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    frequency: 'weekly',
  }), 'Choose a weekday for a weekly task');

  for (const weeklyDay of [0, 6]) {
    assert.equal(parseTaskInput({
      ...dailyTask,
      frequency: 'weekly',
      weeklyDay,
    }).weeklyDay, weeklyDay);
  }
  for (const weeklyDay of [-1, 7]) {
    assert.throws(() => parseTaskInput({
      ...dailyTask,
      frequency: 'weekly',
      weeklyDay,
    }));
  }
});

test('monthly tasks require a valid day of month', () => {
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    frequency: 'monthly',
  }), 'Choose a day for a monthly task');

  assert.equal(parseTaskInput({
    ...dailyTask,
    frequency: 'monthly',
    monthlyDay: 31,
  }).monthlyDay, 31);
  for (const monthlyDay of [0, 32]) {
    assert.throws(() => parseTaskInput({
      ...dailyTask,
      frequency: 'monthly',
      monthlyDay,
    }));
  }
});

test('yearly tasks require both month and day', () => {
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    frequency: 'yearly',
  }), 'Choose a month and day for a yearly task');
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    frequency: 'yearly',
    yearlyMonth: 1,
  }), 'Choose a month and day for a yearly task');
});

test('yearly tasks reject February 29 and dates that do not exist', () => {
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    frequency: 'yearly',
    yearlyMonth: 2,
    yearlyDay: 29,
  }), 'February 29 is not available for yearly tasks');
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    frequency: 'yearly',
    yearlyMonth: 4,
    yearlyDay: 31,
  }), 'That date does not exist in the selected month');
});

test('task input rejects invalid timezones', () => {
  assertHttpError(() => parseTaskInput({
    ...dailyTask,
    timezone: 'Not/A_Timezone',
  }), 'Choose a valid timezone');
});
