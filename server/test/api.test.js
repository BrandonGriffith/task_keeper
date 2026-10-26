import '../src/config.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { closeDatabase, connectToDatabase } from '../src/db.js';
import { runSchedulerTick } from '../src/scheduler.js';

// Requires the API running at API_URL (default http://localhost:3001) against the configured MongoDB.
// Auth routes are rate limited to 10 requests per minute, so wait a minute between runs.
const API_URL = process.env.API_URL || 'http://localhost:3001';
const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const password = 'correct-horse-battery';
let cookie = '';
let db;
let userId;
const extraUserIds = [];

async function call(method, path, body, { auth = true } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const dailyTask = (overrides = {}) => ({
  title: 'Water plants',
  description: 'Front window',
  frequency: 'daily',
  dueTime: '23:59',
  timezone: 'America/New_York',
  ...overrides,
});

async function removeUserData(id) {
  const notifications = await db.collection('notifications').find({ userId: id }, { projection: { _id: 1 } }).toArray();
  await db.collection('notificationDeliveries').deleteMany({
    notificationId: { $in: notifications.map((item) => item._id) },
  });
  await db.collection('notifications').deleteMany({ userId: id });
  await db.collection('occurrences').deleteMany({ userId: id });
  await db.collection('tasks').deleteMany({ userId: id });
  await db.collection('users').deleteOne({ _id: id });
}

describe('Taskeeper API', () => {
  before(async () => {
    db = await connectToDatabase();
  });

  after(async () => {
    for (const id of [userId, ...extraUserIds].filter(Boolean)) await removeUserData(id);
    await closeDatabase();
  });

  it('reports healthy and requires authentication', async () => {
    assert.equal((await call('GET', '/api/health', undefined, { auth: false })).status, 200);
    assert.equal((await call('GET', '/api/tasks', undefined, { auth: false })).status, 401);
  });

  it('registers, rejects bad credentials, and logs in', async () => {
    assert.equal((await call('POST', '/api/auth/register', { email: 'bad', password })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { email, password: 'short' })).status, 400);
    const registered = await call('POST', '/api/auth/register', { email, password });
    assert.equal(registered.status, 201);
    userId = registered.data.user.id;
    assert.equal((await call('POST', '/api/auth/register', { email, password })).status, 409);
    assert.equal((await call('POST', '/api/auth/login', { email, password: 'wrong-password-123' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email, password })).status, 200);
    assert.equal((await call('GET', '/api/auth/me')).data.user.email, email);
  });

  it('validates task input without leaking internals', async () => {
    const cases = [
      dailyTask({ title: '' }),
      dailyTask({ dueTime: '25:00' }),
      dailyTask({ frequency: 'weekly' }),
      dailyTask({ frequency: 'monthly' }),
      dailyTask({ frequency: 'yearly', yearlyMonth: 2, yearlyDay: 30 }),
      dailyTask({ timezone: 'Not/AZone' }),
    ];
    for (const body of cases) {
      const result = await call('POST', '/api/tasks', body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.ok(result.data.error);
      assert.ok(!/stack|\bat .*\.js/.test(JSON.stringify(result.data)));
    }
  });

  it('creates, edits, snoozes, completes, and deletes history', async () => {
    const frequencies = [
      dailyTask(),
      dailyTask({ title: 'Weekly review', frequency: 'weekly', weeklyDay: 1 }),
      dailyTask({ title: 'Pay rent', frequency: 'monthly', monthlyDay: 31 }),
      dailyTask({ title: 'Renew domain', frequency: 'yearly', yearlyMonth: 12, yearlyDay: 25 }),
    ];
    for (const body of frequencies) {
      assert.equal((await call('POST', '/api/tasks', body)).status, 201, body.title);
    }
    const listed = (await call('GET', '/api/tasks')).data.tasks;
    assert.equal(listed.length, 4);
    const task = listed.find((item) => item.title === 'Water plants');

    const edited = await call('PATCH', `/api/tasks/${task.id}`, dailyTask({ title: 'Water all plants', dueTime: '22:30' }));
    assert.equal(edited.status, 200);
    const refreshed = (await call('GET', '/api/tasks')).data.tasks.find((item) => item.id === task.id);
    assert.equal(refreshed.title, 'Water all plants');

    const occurrenceId = refreshed.occurrence_id;
    assert.ok(occurrenceId);
    const first = await call('POST', `/api/tasks/occurrences/${occurrenceId}/snooze`);
    const second = await call('POST', `/api/tasks/occurrences/${occurrenceId}/snooze`);
    assert.equal(first.status, 200);
    assert.ok(new Date(second.data.occurrence.snoozed_until) - new Date(first.data.occurrence.snoozed_until) >= 29 * 60_000);

    const completed = await call('POST', `/api/tasks/occurrences/${occurrenceId}/complete`);
    assert.equal(completed.data.occurrence.status, 'completed');
    assert.equal((await call('POST', `/api/tasks/occurrences/${occurrenceId}/complete`)).status, 404);

    const history = (await call('GET', '/api/tasks/history')).data.occurrences;
    assert.ok(history.some((item) => item.id === occurrenceId));
    assert.equal((await call('DELETE', `/api/tasks/history/${occurrenceId}`)).status, 204);
    assert.equal((await call('DELETE', `/api/tasks/history/${occurrenceId}`)).status, 404);
    assert.equal((await call('GET', '/api/tasks/history?limit=0')).status, 400);
  });

  it('archives, restores, and permanently deletes tasks', async () => {
    const tasks = (await call('GET', '/api/tasks')).data.tasks;
    const target = tasks.find((item) => item.title === 'Weekly review');
    assert.equal((await call('DELETE', `/api/tasks/${target.id}/permanent`)).status, 409);
    assert.equal((await call('DELETE', `/api/tasks/${target.id}`)).status, 204);
    const archived = (await call('GET', '/api/tasks?archived=true')).data.tasks;
    assert.ok(archived.some((item) => item.id === target.id));
    assert.equal((await call('POST', `/api/tasks/${target.id}/restore`)).status, 204);
    assert.equal((await call('DELETE', `/api/tasks/${target.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/tasks/${target.id}/permanent`)).status, 204);
    assert.ok(!(await call('GET', '/api/tasks?archived=true')).data.tasks.some((item) => item.id === target.id));
    assert.equal((await call('DELETE', `/api/tasks/${target.id}/permanent`)).status, 404);
  });

  it('marks overdue occurrences missed, notifies, and deletes notifications', async () => {
    const created = await call('POST', '/api/tasks', dailyTask({ title: 'Overdue check' }));
    const occurrence = await db.collection('occurrences').findOne({ taskId: created.data.task.id });
    await db.collection('occurrences').updateOne(
      { _id: occurrence._id },
      { $set: { dueAt: new Date(Date.now() - 3 * 60 * 60_000) } },
    );
    await runSchedulerTick();

    const missed = await db.collection('occurrences').findOne({ _id: occurrence._id });
    assert.equal(missed.status, 'missed');

    const notifications = (await call('GET', '/api/notifications')).data.notifications;
    const notification = notifications.find((item) => item.occurrence_id === occurrence._id);
    assert.ok(notification, 'missed task should create a notification');
    assert.equal((await call('PATCH', `/api/notifications/${notification.id}/read`)).status, 200);
    assert.equal((await call('DELETE', `/api/notifications/${notification.id}`)).status, 204);
    assert.equal((await call('DELETE', `/api/notifications/${notification.id}`)).status, 404);
  });

  it('stores notification preferences and isolates other users', async () => {
    const saved = await call('PUT', '/api/settings/notifications', {
      inAppEnabled: true,
      systemEnabled: false,
      emailEnabled: false,
    });
    assert.equal(saved.data.preferences.system_enabled, false);
    assert.equal((await call('PUT', '/api/settings/notifications', { inAppEnabled: 'yes' })).status, 400);

    const ownerCookie = cookie;
    const task = (await call('GET', '/api/tasks')).data.tasks[0];
    const other = await call('POST', '/api/auth/register', { email: `other-${email}`, password });
    extraUserIds.push(other.data.user.id);
    assert.equal((await call('PATCH', `/api/tasks/${task.id}`, dailyTask())).status, 404);
    assert.equal((await call('DELETE', `/api/tasks/${task.id}`)).status, 404);
    assert.equal((await call('GET', '/api/tasks')).data.tasks.length, 0);
    cookie = ownerCookie;
  });
});
