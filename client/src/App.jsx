import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import {
  applicationServerKeyFromBase64Url,
  removeCurrentPushSubscription,
} from './push.js';
import { readThemePreference, saveThemePreference } from './theme.js';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const authRetryDelaysMs = [250, 500, 1000, 2000, 4000];
const dueFormatters = new Map();
const dateKeyFormatters = new Map();
const notificationDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatterFor(cache, timezone, options, locale) {
  if (!cache.has(timezone)) {
    cache.set(timezone, new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone }));
  }
  return cache.get(timezone);
}

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function frequencyLabel(task) {
  if (task.frequency === 'weekly') return `Weekly · ${weekdays[task.weekly_day]}`;
  if (task.frequency === 'monthly') return `Monthly · day ${task.monthly_day}`;
  if (task.frequency === 'yearly') return `Yearly · ${task.yearly_month}/${task.yearly_day}`;
  return 'Daily';
}

function formatDue(instant, timezone) {
  if (!instant) return 'No open occurrence';
  return formatterFor(dueFormatters, timezone, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}

function dateKeyInTimezone(instant, timezone) {
  const values = Object.fromEntries(
    formatterFor(dateKeyFormatters, timezone, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }, 'en')
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return values.year * 10_000 + values.month * 100 + values.day;
}

function sameNotifications(current, next) {
  return current.length === next.length && current.every((notification, index) => {
    const candidate = next[index];
    return notification.id === candidate.id
      && notification.occurrence_id === candidate.occurrence_id
      && notification.kind === candidate.kind
      && notification.title === candidate.title
      && notification.body === candidate.body
      && notification.read_at === candidate.read_at
      && notification.created_at === candidate.created_at;
  });
}

function ThemeFooter({ darkMode, onThemeChange }) {
  return (
    <footer className="theme-footer">
      <label className="theme-switch">
        <span>Dark mode</span>
        <input
          type="checkbox"
          role="switch"
          checked={darkMode}
          onChange={(event) => onThemeChange(event.target.checked)}
        />
        <span className="theme-switch-track" aria-hidden="true" />
      </label>
    </footer>
  );
}

function AuthScreen({
  onSignedIn,
  darkMode,
  onThemeChange,
  startupError,
  onRetryStartup,
  onClearStartupError,
}) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    onClearStartupError();
    if (new TextEncoder().encode(password).length > 72) {
      setError('Password cannot exceed 72 UTF-8 bytes.');
      return;
    }
    setBusy(true);
    try {
      const result = await api(`/auth/${mode === 'signup' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      onSignedIn(result.user);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark">t</div>
        <p className="eyebrow">A little more intentional</p>
        <h1>task_keeper</h1>
        <p className="muted">Keep the recurring things from slipping through the cracks.</p>
        <form onSubmit={submit} className="stack-form">
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              required
              maxLength="254"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              type="password"
              minLength="10"
              maxLength="128"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <small>
              Use at least 10 characters and no more than 72 UTF-8 bytes.
            </small>
          </label>
          {startupError && (
            <>
              <p className="error-message" role="alert">{startupError}</p>
              <button type="button" className="text-button" onClick={onRetryStartup}>
                Retry connection
              </button>
            </>
          )}
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="auth-switch">
          {mode === 'signup' ? 'Already have an account?' : 'New to task_keeper?'}
          {' '}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setError('');
            }}
          >
            {mode === 'signup' ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </div>
      <ThemeFooter darkMode={darkMode} onThemeChange={onThemeChange} />
    </main>
  );
}

function defaultTaskSchedule(now = new Date()) {
  const suggested = new Date(now.getTime() + 10 * 60_000);
  const yearlyDateIsLeapDay = suggested.getMonth() === 1 && suggested.getDate() === 29;
  return {
    dueTime: `${String(suggested.getHours()).padStart(2, '0')}:${String(suggested.getMinutes()).padStart(2, '0')}`,
    weeklyDay: suggested.getDay(),
    monthlyDay: suggested.getDate(),
    yearlyMonth: yearlyDateIsLeapDay ? 3 : suggested.getMonth() + 1,
    yearlyDay: yearlyDateIsLeapDay ? 1 : suggested.getDate(),
  };
}

function TaskForm({ task, onClose, onSave }) {
  const now = new Date();
  const defaults = defaultTaskSchedule(now);
  const monthLength = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const [form, setForm] = useState(() => ({
    title: task?.title ?? '',
    description: task?.description ?? '',
    frequency: task?.frequency ?? 'daily',
    dueTime: task?.due_time?.slice(0, 5) ?? defaults.dueTime,
    timezone: task?.timezone ?? localTimezone(),
    weeklyDay: task?.weekly_day ?? defaults.weeklyDay,
    monthlyDay: task?.monthly_day ?? Math.min(defaults.monthlyDay, monthLength),
    yearlyMonth: task?.yearly_month ?? defaults.yearlyMonth,
    yearlyDay: task?.yearly_day ?? defaults.yearlyDay,
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const yearDays = new Date(2000, form.yearlyMonth, 0).getDate();
  const allowedYearDays = form.yearlyMonth === 2 ? Math.min(yearDays, 28) : yearDays;

  function changeFrequency(nextFrequency) {
    setForm((current) => ({
      ...current,
      frequency: nextFrequency,
      yearlyDay: Math.min(current.yearlyDay, allowedYearDays),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const payload = {
      title: form.title,
      description: form.description,
      frequency: form.frequency,
      dueTime: form.dueTime,
      timezone: form.timezone,
      ...(form.frequency === 'weekly' ? { weeklyDay: Number(form.weeklyDay) } : {}),
      ...(form.frequency === 'monthly' ? { monthlyDay: Number(form.monthlyDay) } : {}),
      ...(form.frequency === 'yearly'
        ? { yearlyMonth: Number(form.yearlyMonth), yearlyDay: Number(form.yearlyDay) }
        : {}),
    };
    try {
      await onSave(payload);
      onClose();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="task-form-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{task ? 'Update your routine' : 'Make room for what matters'}</p>
            <h2 id="task-form-title">{task ? 'Edit task' : 'New task'}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form className="stack-form" onSubmit={submit}>
          <label>
            Task name
            <input
              autoFocus
              required
              maxLength="120"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="e.g. Water the plants"
            />
          </label>
          <label>
            Notes <span className="optional">(optional)</span>
            <textarea
              rows="3"
              maxLength="2000"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <div className="form-row">
            <label>
              Repeats
              <select value={form.frequency} onChange={(event) => changeFrequency(event.target.value)}>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            </label>
            <label>
              Due time
              <input
                type="time"
                required
                value={form.dueTime}
                onChange={(event) => setForm({ ...form, dueTime: event.target.value })}
              />
              {!task && (
                <small>
                  Defaults to 10 minutes from now. The first occurrence is today if this time
                  has not passed; otherwise, it starts at the next scheduled time.
                </small>
              )}
            </label>
          </div>
          {form.frequency === 'weekly' && (
            <label>
              Due weekday
              <select
                value={form.weeklyDay}
                onChange={(event) => setForm({ ...form, weeklyDay: Number(event.target.value) })}
              >
                {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
            </label>
          )}
          {form.frequency === 'monthly' && (
            <label>
              Day of month
              <select
                required
                value={form.monthlyDay}
                onChange={(event) => setForm({ ...form, monthlyDay: Number(event.target.value) })}
              >
                {Array.from({ length: 31 }, (_, index) => index + 1)
                  .map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
              <small>
                In a shorter month, the task moves to its last day and a notice is added.
              </small>
            </label>
          )}
          {form.frequency === 'yearly' && (
            <div className="form-row">
              <label>
                Month
                <select
                  value={form.yearlyMonth}
                  onChange={(event) => {
                    const yearlyMonth = Number(event.target.value);
                    const maxDays = yearlyMonth === 2
                      ? 28
                      : new Date(2000, yearlyMonth, 0).getDate();
                    setForm({
                      ...form,
                      yearlyMonth,
                      yearlyDay: Math.min(form.yearlyDay, maxDays),
                    });
                  }}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {new Date(2000, index, 1).toLocaleString(undefined, { month: 'long' })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Day
                <select
                  value={form.yearlyDay}
                  onChange={(event) => setForm({ ...form, yearlyDay: Number(event.target.value) })}
                >
                  {Array.from({ length: allowedYearDays }, (_, index) => index + 1)
                    .map((day) => <option key={day} value={day}>{day}</option>)}
                </select>
              </label>
            </div>
          )}
          <p className="timezone-note">
            Times follow this task's timezone: <strong>{form.timezone}</strong>
          </p>
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" disabled={busy}>
              {busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TaskCard({ task, onEdit, onComplete, onSnooze, onArchive, onRestore, onDelete }) {
  const isOpen = Boolean(task.occurrence_id);
  const dueNow = task.due_at && new Date(task.due_at) <= new Date();
  const canComplete = task.due_at
    && task.timezone
    && dateKeyInTimezone(new Date(task.due_at), task.timezone)
      <= dateKeyInTimezone(new Date(), task.timezone);
  const isMissed = task.occurrence_status === 'missed';
  const isSnoozed = task.snoozed_until && new Date(task.snoozed_until) > new Date();
  const dueLabel = isSnoozed
    ? 'Snoozed until'
    : isMissed ? 'Missed occurrence' : isOpen ? 'Next due' : 'Schedule';
  const displayedDue = isSnoozed ? task.snoozed_until : task.due_at;
  return (
    <article className={`task-card ${isMissed ? 'task-card-missed' : ''}`}>
      <div className="task-card-top">
        <div className="task-title-wrap">
          <span className={`status-dot ${isMissed ? 'status-dot-missed' : ''}`} />
          <div>
            <h3>{task.title}</h3>
            <p className="task-meta">{frequencyLabel(task)}</p>
          </div>
        </div>
        <button className="quiet-button" onClick={() => onEdit(task)} disabled={task.archived}>
          Edit
        </button>
      </div>
      {task.description && <p className="task-description">{task.description}</p>}
      <div className="task-card-bottom">
        <div>
          <p className="due-label">{dueLabel}</p>
          <p className="due-date">{formatDue(displayedDue, task.timezone)}</p>
          {task.date_adjusted && (
            <p className="adjustment-note">Moved to this month’s last day; see notification history.</p>
          )}
        </div>
        <div className="task-actions">
          {!task.archived && isOpen && (
            <>
              <button
                className="secondary-button small-button"
                onClick={() => onComplete(task.occurrence_id)}
                disabled={!canComplete}
              >
                Complete
              </button>
              {(isMissed || dueNow) && (
                <button className="quiet-button" onClick={() => onSnooze(task.occurrence_id)}>
                  Snooze 30m
                </button>
              )}
            </>
          )}
          {task.archived ? (
            <>
              <button className="quiet-button" onClick={() => onRestore(task.id)}>Restore</button>
              <button className="quiet-button danger-button" onClick={() => onDelete(task)}>Delete permanently</button>
            </>
          ) : <button className="quiet-button danger-button" onClick={() => onArchive(task.id)}>Archive</button>}
        </div>
      </div>
    </article>
  );
}

function NotificationSettings({
  settings,
  browserPermission,
  browserAlertsReady,
  backgroundPushReady,
  onChange,
  onEnableBrowser,
  onEnablePush,
  onDisablePush,
  notice,
  busy,
}) {
  if (!settings) return null;
  const { preferences } = settings;
  const supportsBackgroundPush = 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && window.isSecureContext;
  let browserAlertStatus = 'Permission is needed to show task reminders';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    browserAlertStatus = 'Not supported by this browser';
  } else if (!window.isSecureContext) {
    browserAlertStatus = 'Requires HTTPS or localhost';
  } else if (browserPermission === 'granted') {
    browserAlertStatus = browserAlertsReady
      ? 'Allowed; task reminders appear as browser alerts while this app is open'
      : 'Permission granted; browser alerts still need setup';
  } else if (browserPermission === 'denied') {
    browserAlertStatus = 'Blocked in browser site settings';
  }
  let backgroundPushStatus = browserPermission === 'granted'
    ? 'No push subscription is set up in this browser'
    : 'Permission is needed to set up background push';
  if (!settings.availability.system) {
    backgroundPushStatus = 'Background push is not configured on the server';
  } else if (!supportsBackgroundPush) {
    backgroundPushStatus = 'Requires a supported browser and HTTPS or localhost';
  } else if (browserPermission === 'denied') {
    backgroundPushStatus = 'Blocked in browser site settings';
  } else if (backgroundPushReady) {
    backgroundPushStatus = preferences.system_enabled
      ? 'A push subscription is present in this browser'
      : 'This browser has a subscription, but background push is disabled for the account';
  }
  return (
    <section className="settings-card">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Stay in the loop</p>
          <h2>Reminders</h2>
        </div>
      </div>
      <div className="preference-row browser-alert-row">
        <span>
          <strong>Browser alerts while open</strong>
          <small>{browserAlertStatus}. Requires In-app reminders to be enabled.</small>
        </span>
        {!browserAlertsReady && browserPermission !== 'denied' && (
          <button
            type="button"
            className="secondary-button"
            onClick={onEnableBrowser}
            disabled={
              busy
              || !('Notification' in window)
              || !('serviceWorker' in navigator)
              || !window.isSecureContext
            }
          >
            Enable browser notifications
          </button>
        )}
      </div>
      <label className="preference-row">
        <span><strong>In-app</strong><small>Keep a record in Notifications</small></span>
        <input
          type="checkbox"
          checked={preferences.in_app_enabled}
          disabled={busy}
          onChange={(event) => onChange({ ...preferences, inAppEnabled: event.target.checked })}
        />
      </label>
      {settings.availability.system && (
        <label className="preference-row">
          <span>
            <strong>Background push</strong>
            <small>Allow push reminders on subscribed browsers, even when the app is closed</small>
          </span>
          <input
            type="checkbox"
            checked={preferences.system_enabled}
            disabled={busy}
            onChange={(event) => onChange({
              ...preferences,
              systemEnabled: event.target.checked,
            })}
          />
        </label>
      )}
      {(settings.availability.system || backgroundPushReady) ? (
        <div className="preference-row browser-alert-row">
          <span>
            <strong>This browser</strong>
            <small>{backgroundPushStatus}.</small>
          </span>
          <div className="push-actions">
            {settings.availability.system && (
              <button
                type="button"
                className="secondary-button"
                onClick={onEnablePush}
                disabled={
                  busy
                  || !supportsBackgroundPush
                  || browserPermission === 'denied'
                }
              >
                {backgroundPushReady ? 'Set up / sync this browser' : 'Set up this browser'}
              </button>
            )}
            {backgroundPushReady && (
              <button
                type="button"
                className="quiet-button"
                onClick={onDisablePush}
                disabled={busy}
              >
                Remove this browser
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="preference-row browser-alert-row">
          <span>
            <strong>Background push</strong>
            <small>Unavailable until the server is configured with VAPID keys.</small>
          </span>
        </div>
      )}
      {notice && <p className="settings-notice" role="status">{notice}</p>}
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authRetryKey, setAuthRetryKey] = useState(0);
  const [darkMode, setDarkMode] = useState(() => {
    const savedTheme = readThemePreference();
    return savedTheme === null || savedTheme === 'dark';
  });
  const [tab, setTab] = useState('tasks');
  const [tasks, setTasks] = useState([]);
  const [archivedTasks, setArchivedTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyNextCursor, setHistoryNextCursor] = useState(null);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState(null);
  const [modalTask, setModalTask] = useState(undefined);
  const [pageError, setPageError] = useState('');
  const [toast, setToast] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [browserPermission, setBrowserPermission] = useState(() => (
    'Notification' in window ? Notification.permission : 'unsupported'
  ));
  const [browserAlertsReady, setBrowserAlertsReady] = useState(false);
  const [backgroundPushReady, setBackgroundPushReady] = useState(false);
  const notificationIds = useRef(new Set());
  const toastTimer = useRef(null);
  const activeUserId = useRef(null);
  const refreshGeneration = useRef(0);
  const historyLoadInFlight = useRef(false);

  function activateUser(nextUser) {
    activeUserId.current = nextUser?.id ?? null;
    refreshGeneration.current += 1;
    setUser(nextUser);
  }

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    saveThemePreference(darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const refreshData = useCallback(async () => {
    const requestUserId = activeUserId.current;
    if (!requestUserId) return;
    const requestGeneration = ++refreshGeneration.current;
    const [taskData, historyData, notificationData, settingsData] = await Promise.all([
      api('/tasks'),
      api('/tasks/history?limit=100&offset=0'),
      api('/notifications'),
      api('/settings/notifications'),
    ]);
    if (
      !requestUserId
      || activeUserId.current !== requestUserId
      || refreshGeneration.current !== requestGeneration
    ) return;

    setTasks(taskData.tasks);
    setHistory(historyData.occurrences);
    setHistoryNextCursor(historyData.next_cursor);
    notificationIds.current = new Set(notificationData.notifications.map((notification) => notification.id));
    setNotifications(notificationData.notifications);
    setSettings(settingsData);
  }, []);

  useEffect(() => {
    let active = true;
    let retryTimer;

    async function checkSession() {
      let attempt = 0;
      while (active) {
        try {
          const result = await api('/auth/me');
          if (active) {
            setPageError('');
            activateUser(result.user);
          }
          break;
        } catch (error) {
          if (!active) return;
          if (error.status === 401) break;
          if (error.status !== undefined && error.status < 500) {
            if (active) setPageError(error.message);
            break;
          }
          if (attempt >= authRetryDelaysMs.length) {
            if (active) setPageError(error.message);
            break;
          }
          await new Promise((resolve) => {
            retryTimer = window.setTimeout(resolve, authRetryDelaysMs[attempt]);
          });
          attempt += 1;
        }
      }
      if (active) setAuthChecked(true);
    }

    void checkSession();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [authRetryKey]);

  useEffect(() => {
    if (!user) return;
    const requestUserId = user.id;
    refreshData().catch((error) => {
      if (activeUserId.current === requestUserId) setPageError(error.message);
    });
  }, [user, refreshData]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const pollNotifications = async () => {
      try {
        const result = await api('/notifications');
        if (!active) return;
        const unseen = result.notifications.filter(
          (notification) => !notificationIds.current.has(notification.id) && !notification.read_at,
        );
        notificationIds.current = new Set(result.notifications.map((notification) => notification.id));
        setNotifications((current) => (
          sameNotifications(current, result.notifications) ? current : result.notifications
        ));
        if (unseen.length) {
          await refreshData();
          if (!active) return;
          if (browserAlertsReady) {
            const reminders = unseen.filter((notification) => notification.kind === 'reminder');
            if (reminders.length) {
              try {
                const registration = await navigator.serviceWorker.getRegistration();
                if (!registration) throw new Error('No service worker is registered for browser alerts.');
                await Promise.all(reminders.map((notification) => registration.showNotification(
                  notification.title,
                  {
                    body: notification.body,
                    icon: '/icon.svg',
                    badge: '/icon.svg',
                    tag: notification.id,
                    data: { url: '/' },
                  },
                )));
              } catch (error) {
                console.error('Could not display a task reminder browser notification.', error);
              }
            }
          }
          if (!browserAlertsReady && document.visibilityState === 'visible') {
            notify(unseen.length === 1 ? `Reminder: ${unseen[0].body}` : `${unseen.length} new reminders`);
          }
        }
      } catch (error) {
        if (active) console.error('Notification polling failed; it will retry automatically.', error);
      }
    };
    const interval = window.setInterval(pollNotifications, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user, refreshData, browserAlertsReady]);

  useEffect(() => {
    let active = true;
    const updatePermission = async () => {
      const permission = 'Notification' in window ? Notification.permission : 'unsupported';
      setBrowserPermission(permission);
      if (permission !== 'granted' || !('serviceWorker' in navigator)) {
        setBrowserAlertsReady(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (active) setBrowserAlertsReady(Boolean(registration));
      } catch (error) {
        if (active) console.error('Could not check browser notification setup.', error);
      }
    };
    void updatePermission();
    window.addEventListener('focus', updatePermission);
    return () => {
      active = false;
      window.removeEventListener('focus', updatePermission);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const updatePushSubscription = async () => {
      if (!user || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setBackgroundPushReady(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (active) setBackgroundPushReady(Boolean(subscription));
      } catch (error) {
        if (active) console.error('Could not check browser push setup.', error);
      }
    };
    void updatePushSubscription();
    window.addEventListener('focus', updatePushSubscription);
    return () => {
      active = false;
      window.removeEventListener('focus', updatePushSubscription);
    };
  }, [user]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications],
  );

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) task_keeper` : 'task_keeper';
  }, [unreadCount]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  function notify(message) {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast('');
    }, 3200);
  }

  async function saveTask(payload) {
    const path = modalTask?.id ? `/tasks/${modalTask.id}` : '/tasks';
    await api(path, {
      method: modalTask?.id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    await refreshData();
    notify(modalTask?.id ? 'Task updated.' : 'Task added.');
  }

  async function completeOccurrence(id) {
    try {
      await api(`/tasks/occurrences/${id}/complete`, { method: 'POST', body: '{}' });
      await refreshData();
      notify('Nice work. That occurrence is complete.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function snoozeOccurrence(id) {
    try {
      await api(`/tasks/occurrences/${id}/snooze`, { method: 'POST', body: '{}' });
      await refreshData();
      notify('Reminder snoozed for 30 minutes.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function archiveTask(id) {
    if (!window.confirm('Archive this task? Its history will be kept.')) return;
    try {
      await api(`/tasks/${id}`, { method: 'DELETE' });
      await refreshData();
      notify('Task archived. Its history is still available.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function restoreTask(id) {
    try {
      await api(`/tasks/${id}/restore`, { method: 'POST', body: '{}' });
      setArchivedTasks((items) => items.filter((task) => task.id !== id));
      await refreshData();
      notify('Task restored.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function deleteArchivedTask(task) {
    if (!window.confirm(`Permanently delete "${task.title}" and all of its history and notifications? This cannot be undone.`)) {
      return;
    }
    try {
      await api(`/tasks/${task.id}/permanent`, { method: 'DELETE' });
      setArchivedTasks((items) => items.filter((item) => item.id !== task.id));
      await refreshData();
      notify('Archived task and its history deleted.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function deleteHistoryItem(item) {
    if (!window.confirm(`Delete this history entry for "${item.title}"? Its linked notifications will also be deleted. Any active missed task will remain in My tasks.`)) {
      return;
    }
    try {
      await api(`/tasks/history/${item.id}`, { method: 'DELETE' });
      const page = await api('/tasks/history?limit=100&offset=0');
      setHistory(page.occurrences);
      setHistoryNextCursor(page.next_cursor);
      notify('History entry deleted.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function clearHistory() {
    if (!window.confirm('Clear all completed and missed history entries? Active missed tasks will remain in My tasks. Linked notifications and delivery records will also be deleted. This cannot be undone.')) {
      return;
    }
    setClearingHistory(true);
    try {
      await api('/tasks/history', { method: 'DELETE' });
      await refreshData();
      notify('History cleared.');
    } catch (error) {
      setPageError(error.message);
    } finally {
      setClearingHistory(false);
    }
  }

  async function deleteNotification(notification) {
    if (!window.confirm(`Delete the "${notification.title}" notification?`)) return;
    try {
      await api(`/notifications/${notification.id}`, { method: 'DELETE' });
      setNotifications((items) => items.filter((item) => item.id !== notification.id));
      notificationIds.current.delete(notification.id);
      notify('Notification deleted.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function clearNotifications() {
    if (!window.confirm('Clear all notifications and their pending deliveries? This cannot be undone.')) {
      return;
    }
    setClearingNotifications(true);
    try {
      await api('/notifications', { method: 'DELETE' });
      await refreshData();
      notify('Notifications cleared.');
    } catch (error) {
      setPageError(error.message);
    } finally {
      setClearingNotifications(false);
    }
  }

  async function updatePreferences(next) {
    setSettingsBusy(true);
    setSettingsNotice('');
    try {
      const updated = await saveNotificationPreferences(next);
      setSettings(updated);
      return true;
    } catch (error) {
      setSettingsNotice(error.message);
      return false;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function saveNotificationPreferences(next) {
    await api('/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify({
        inAppEnabled: next.inAppEnabled ?? next.in_app_enabled,
        systemEnabled: next.systemEnabled ?? next.system_enabled,
        emailEnabled: next.emailEnabled ?? next.email_enabled,
      }),
    });
    return api('/settings/notifications');
  }

  async function enableBrowserNotifications() {
    setSettingsBusy(true);
    setSettingsNotice('');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('This browser does not support browser notifications.');
      }
      if (!window.isSecureContext) {
        throw new Error('Browser notifications require HTTPS or localhost.');
      }
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission !== 'granted') {
        throw new Error('Allow notifications in your browser to enable task alerts.');
      }
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      setBrowserAlertsReady(true);
      setSettingsNotice('Browser notifications are enabled while task_keeper is open.');
    } catch (error) {
      setSettingsNotice(error.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function enableBackgroundPush() {
    setSettingsBusy(true);
    setSettingsNotice('');
    try {
      if (!settings?.availability.system || !settings.publicKey) {
        throw new Error('Background push is not configured on the server.');
      }
      if (
        !('Notification' in window)
        || !('serviceWorker' in navigator)
        || !('PushManager' in window)
      ) {
        throw new Error('This browser does not support background push.');
      }
      if (!window.isSecureContext) {
        throw new Error('Background push requires HTTPS or localhost.');
      }
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission !== 'granted') {
        throw new Error('Allow notifications in your browser to enable background push.');
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      setBrowserAlertsReady(true);
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKeyFromBase64Url(settings.publicKey),
        });
      }
      await api('/push-subscriptions', {
        method: 'POST',
        body: JSON.stringify(subscription.toJSON()),
      });
      setBackgroundPushReady(true);

      const updatedSettings = settings.preferences.system_enabled
        ? settings
        : await saveNotificationPreferences({
          ...settings.preferences,
          systemEnabled: true,
        });
      setSettings(updatedSettings);
      setSettingsNotice('Background push is set up for this browser.');
    } catch (error) {
      setSettingsNotice(error.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function disableBackgroundPush() {
    setSettingsBusy(true);
    setSettingsNotice('');
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api('/push-subscriptions', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setBackgroundPushReady(false);
      setSettingsNotice('Background push was removed from this browser.');
    } catch (error) {
      setSettingsNotice(error.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function markRead(notification) {
    if (notification.read_at) return;
    try {
      await api(`/notifications/${notification.id}/read`, { method: 'PATCH', body: '{}' });
      setNotifications((items) => items.map((item) => item.id === notification.id
        ? { ...item, read_at: new Date().toISOString() }
        : item));
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function loadOlderHistory() {
    if (historyNextCursor === null || historyLoadInFlight.current) return;
    historyLoadInFlight.current = true;
    setLoadingOlderHistory(true);
    try {
      const query = new URLSearchParams({
        limit: '100',
        before_due_at: historyNextCursor.due_at,
        before_id: historyNextCursor.id,
      });
      const page = await api(`/tasks/history?${query}`);
      setHistory((items) => [...items, ...page.occurrences]);
      setHistoryNextCursor(page.next_cursor);
    } catch (error) {
      setPageError(error.message);
    } finally {
      historyLoadInFlight.current = false;
      setLoadingOlderHistory(false);
    }
  }

  async function openArchivedTasks() {
    const requestUserId = activeUserId.current;
    if (!requestUserId) return;
    setLoadingArchived(true);
    try {
      const result = await api('/tasks?archived=true');
      if (activeUserId.current !== requestUserId) return;
      setArchivedTasks(result.tasks.map((task) => ({ ...task, archived: true })));
      setShowArchived(true);
    } catch (error) {
      if (activeUserId.current === requestUserId) setPageError(error.message);
    } finally {
      if (activeUserId.current === requestUserId) setLoadingArchived(false);
    }
  }

  async function signOut() {
    try {
      if ('serviceWorker' in navigator) {
        await removeCurrentPushSubscription(
          navigator.serviceWorker,
          (endpoint) => api('/push-subscriptions', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint }),
          }),
        );
      }
      await api('/auth/logout', { method: 'POST', body: '{}' });
      activateUser(null);
      setTasks([]);
      setArchivedTasks([]);
      setHistory([]);
      setHistoryNextCursor(null);
      setNotifications([]);
      setSettings(null);
      setPageError('');
      setShowArchived(false);
      setLoadingArchived(false);
      setTab('tasks');
      notificationIds.current.clear();
    } catch (error) {
      setPageError(error.message);
    }
  }

  if (!authChecked) {
    return <main className="loading-screen"><div className="brand-mark">t</div><p>Getting things ready…</p></main>;
  }
  if (!user) {
    return (
      <AuthScreen
        onSignedIn={(account) => {
          setPageError('');
          activateUser(account);
        }}
        darkMode={darkMode}
        onThemeChange={setDarkMode}
        startupError={pageError}
        onClearStartupError={() => setPageError('')}
        onRetryStartup={() => {
          setPageError('');
          setAuthChecked(false);
          setAuthRetryKey((current) => current + 1);
        }}
      />
    );
  }

  const visibleTasks = showArchived ? archivedTasks : tasks;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="task_keeper home">
          <span className="brand-mark small-mark">t</span>
          <span>task_keeper</span>
        </a>
        <p className="sidebar-caption">YOUR SPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={tab === 'tasks' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('tasks')}>
            <span>○</span> My tasks
          </button>
          <button className={tab === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('history')}>
            <span>↺</span> History
          </button>
          <button className={tab === 'notifications' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('notifications')}>
            <span>♧</span> Notifications
            {unreadCount > 0 && <span className="count-badge">{unreadCount}</span>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip">
            <span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span>
            <span className="user-email">{user.email}</span>
          </div>
          <button className="nav-item signout-button" onClick={signOut}>↗ Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">My space <span>/</span> {tab === 'tasks' ? 'Tasks' : tab === 'history' ? 'History' : 'Notifications'}</div>
          {tab === 'tasks' && !showArchived && (
            <button className="primary-button add-button" onClick={() => setModalTask(null)}>＋ New task</button>
          )}
        </header>

        {pageError && (
          <div className="page-alert" role="alert">
            <span>{pageError}</span>
            <button onClick={() => setPageError('')} aria-label="Dismiss">×</button>
          </div>
        )}

        {tab === 'tasks' && (
          <div className="page-content">
            <div className="page-intro">
              <div>
                <p className="eyebrow">{new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date())}</p>
                <h1>{showArchived ? 'Archived tasks' : 'Your routines'}</h1>
                <p className="muted">
                  {showArchived ? 'Past schedules stay here, with their history intact.' : 'A steady rhythm, one task at a time.'}
                </p>
              </div>
              <button
                className="text-button archive-toggle"
                disabled={loadingArchived}
                onClick={() => {
                  if (showArchived) setShowArchived(false);
                  else void openArchivedTasks();
                }}
              >
                {loadingArchived ? 'Loading archived tasks…' : showArchived ? '← Back to active tasks' : 'View archived'}
              </button>
            </div>
            {visibleTasks.length ? (
              <div className="task-list">
                {visibleTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onEdit={(value) => setModalTask(value)}
                    onComplete={completeOccurrence}
                    onSnooze={snoozeOccurrence}
                    onArchive={archiveTask}
                    onRestore={restoreTask}
                    onDelete={deleteArchivedTask}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illustration">✳</div>
                <h2>{showArchived ? 'No archived tasks' : 'Start with one small routine'}</h2>
                <p>{showArchived ? 'Archived tasks will appear here.' : 'Add a recurring task and we’ll help you keep it in view.'}</p>
                {!showArchived && <button className="primary-button" onClick={() => setModalTask(null)}>Create your first task</button>}
              </div>
            )}
            <NotificationSettings
              settings={settings}
              browserPermission={browserPermission}
              browserAlertsReady={browserAlertsReady}
              backgroundPushReady={backgroundPushReady}
              onChange={updatePreferences}
              onEnableBrowser={enableBrowserNotifications}
              onEnablePush={enableBackgroundPush}
              onDisablePush={disableBackgroundPush}
              notice={settingsNotice}
              busy={settingsBusy}
            />
          </div>
        )}

        {tab === 'history' && (
          <div className="page-content">
            <div className="page-intro">
              <div>
                <p className="eyebrow">Every attempt counts</p>
                <h1>Task history</h1>
                <p className="muted">Completed and missed occurrences stay here.</p>
              </div>
              {history.length > 0 && (
                <button
                  className="quiet-button danger-button clear-all-button"
                  onClick={clearHistory}
                  disabled={clearingHistory}
                >
                  {clearingHistory ? 'Clearing…' : 'Clear history'}
                </button>
              )}
            </div>
            {history.length ? (
              <>
                <div className="history-list">
                  {history.map((item) => (
                    <article key={item.id} className="history-item">
                      <span className={`history-icon ${item.missed_at ? 'history-missed' : 'history-complete'}`}>
                        {item.missed_at ? '!' : '✓'}
                      </span>
                      <div className="history-main">
                        <h3>{item.title}</h3>
                        <p>Due {formatDue(item.due_at, item.timezone)}</p>
                        {item.snooze_history.map((snoozedAt, index) => (
                          <p key={`${snoozedAt}-${index}`}>
                            Snoozed {formatDue(snoozedAt, item.timezone)}
                          </p>
                        ))}
                        {item.completed_at && (
                          <p>Completed {formatDue(item.completed_at, item.timezone)}</p>
                        )}
                      </div>
                      <span className={`history-status ${item.status === 'missed' ? 'missed-text' : ''}`}>
                        {item.status === 'completed'
                          ? item.missed_at ? 'Completed late' : 'Completed'
                          : item.status === 'missed' ? 'Missed' : 'Upcoming'}
                      </span>
                      <button
                        className="quiet-button danger-button history-delete"
                        aria-label={`Delete history entry for ${item.title}`}
                        onClick={() => deleteHistoryItem(item)}
                      >
                        Delete
                      </button>
                    </article>
                  ))}
                </div>
                {historyNextCursor !== null && (
                  <button
                    className="secondary-button load-more"
                    onClick={loadOlderHistory}
                    disabled={loadingOlderHistory}
                  >
                    {loadingOlderHistory ? 'Loading older history…' : 'Load older history'}
                  </button>
                )}
              </>
            ) : <div className="empty-state"><h2>Your history starts here</h2><p>Task occurrences will appear as they come due.</p></div>}
          </div>
        )}

        {tab === 'notifications' && (
          <div className="page-content">
            <div className="page-intro">
              <div>
                <p className="eyebrow">A gentle nudge</p>
                <h1>Notifications</h1>
                <p className="muted">Reminders and schedule updates from your tasks.</p>
              </div>
              {notifications.length > 0 && (
                <button
                  className="quiet-button danger-button clear-all-button"
                  onClick={clearNotifications}
                  disabled={clearingNotifications}
                >
                  {clearingNotifications ? 'Clearing…' : 'Clear notifications'}
                </button>
              )}
            </div>
            {notifications.length ? (
              <div className="notification-list">
                {notifications.map((notification) => (
                  <article
                    key={notification.id}
                    className={`notification-item ${notification.read_at ? '' : 'notification-unread'}`}
                  >
                    <button
                      className="notification-content"
                      onClick={() => markRead(notification)}
                      aria-label={notification.read_at ? notification.title : `Mark ${notification.title} as read`}
                      disabled={Boolean(notification.read_at)}
                    >
                      <span className="notification-indicator" />
                      <span className="notification-copy">
                        <strong>{notification.title}</strong>
                        <span>{notification.body}</span>
                        <small>{notificationDateFormatter.format(new Date(notification.created_at))}</small>
                      </span>
                      {!notification.read_at && <span className="unread-label">New</span>}
                    </button>
                    <button
                      className="quiet-button danger-button notification-delete"
                      aria-label={`Delete notification: ${notification.title}`}
                      onClick={() => deleteNotification(notification)}
                    >
                      Delete
                    </button>
                  </article>
                ))}
              </div>
            ) : <div className="empty-state"><h2>All quiet for now</h2><p>Your reminders and schedule notices will show up here.</p></div>}
          </div>
        )}
        <ThemeFooter darkMode={darkMode} onThemeChange={setDarkMode} />
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {modalTask !== undefined && (
        <TaskForm
          key={modalTask?.id ?? 'new'}
          task={modalTask}
          onClose={() => setModalTask(undefined)}
          onSave={saveTask}
        />
      )}
    </div>
  );
}
