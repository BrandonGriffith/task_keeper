import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
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

function AuthScreen({ onSignedIn, darkMode, onThemeChange }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
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
            {mode === 'signup' && <small>Use at least 10 characters.</small>}
          </label>
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

function defaultDueTime(now = new Date()) {
  const suggested = new Date(now.getTime() + 10 * 60_000);
  return `${String(suggested.getHours()).padStart(2, '0')}:${String(suggested.getMinutes()).padStart(2, '0')}`;
}

function TaskForm({ task, onClose, onSave }) {
  const now = new Date();
  const monthLength = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const [form, setForm] = useState(() => ({
    title: task?.title ?? '',
    description: task?.description ?? '',
    frequency: task?.frequency ?? 'daily',
    dueTime: task?.due_time?.slice(0, 5) ?? defaultDueTime(now),
    timezone: task?.timezone ?? localTimezone(),
    weeklyDay: task?.weekly_day ?? now.getDay(),
    monthlyDay: task?.monthly_day ?? Math.min(now.getDate(), monthLength),
    yearlyMonth: task?.yearly_month ?? now.getMonth() + 1,
    yearlyDay: task?.yearly_day ?? Math.min(now.getDate(), monthLength),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const yearDays = new Date(2000, form.yearlyMonth, 0).getDate();
  const allowedYearDays = form.yearlyMonth === 2 ? Math.min(yearDays, 28) : yearDays;

  function changeFrequency(nextFrequency) {
    setForm((current) => ({
      ...current,
      frequency: nextFrequency,
      monthlyDay: Math.min(current.monthlyDay, monthLength),
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
                {task?.monthly_day > monthLength && (
                  <option value={task.monthly_day} disabled>
                    {task.monthly_day} (saved schedule; short months use month-end)
                  </option>
                )}
                {Array.from({ length: monthLength }, (_, index) => index + 1)
                  .map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
              <small>
                Only dates available this month are offered. In a shorter future month, the task
                moves to its last day and a notice is added.
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
            Times follow your device timezone: <strong>{form.timezone}</strong>
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
              <button className="secondary-button small-button" onClick={() => onComplete(task.occurrence_id)}>
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
  onChange,
  onEnableBrowser,
  notice,
  busy,
}) {
  if (!settings) return null;
  const { preferences } = settings;
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
      {notice && <p className="settings-notice" role="status">{notice}</p>}
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const savedTheme = window.localStorage.getItem('theme');
    return savedTheme === null || savedTheme === 'dark';
  });
  const [tab, setTab] = useState('tasks');
  const [tasks, setTasks] = useState([]);
  const [archivedTasks, setArchivedTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyNextOffset, setHistoryNextOffset] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [settings, setSettings] = useState(null);
  const [modalTask, setModalTask] = useState(undefined);
  const [pageError, setPageError] = useState('');
  const [toast, setToast] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState('');
  const [browserPermission, setBrowserPermission] = useState(() => (
    'Notification' in window ? Notification.permission : 'unsupported'
  ));
  const [browserAlertsReady, setBrowserAlertsReady] = useState(false);
  const notificationIds = useRef(new Set());

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    window.localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const refreshData = useCallback(async () => {
    const [taskData, historyData, notificationData, settingsData, archivedData] = await Promise.all([
      api('/tasks'),
      api('/tasks/history?limit=100&offset=0'),
      api('/notifications'),
      api('/settings/notifications'),
      api('/tasks?archived=true'),
    ]);
    setTasks(taskData.tasks);
    setHistory(historyData.occurrences);
    setHistoryNextOffset(historyData.nextOffset);
    notificationIds.current = new Set(notificationData.notifications.map((notification) => notification.id));
    setNotifications(notificationData.notifications);
    setSettings(settingsData);
    setArchivedTasks(archivedData.tasks.map((task) => ({ ...task, archived: true })));
  }, []);

  useEffect(() => {
    api('/auth/me')
      .then((result) => setUser(result.user))
      .catch((error) => {
        if (error.status !== 401) setPageError(error.message);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshData().catch((error) => setPageError(error.message));
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
        setNotifications(result.notifications);
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

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications],
  );

  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) task_keeper` : 'task_keeper';
  }, [unreadCount]);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
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
      await refreshData();
      notify('Archived task and its history deleted.');
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function deleteHistoryItem(item) {
    if (!window.confirm(`Delete this history entry for "${item.title}"? Its linked notifications will also be deleted.`)) {
      return;
    }
    try {
      await api(`/tasks/history/${item.id}`, { method: 'DELETE' });
      const page = await api('/tasks/history?limit=100&offset=0');
      setHistory(page.occurrences);
      setHistoryNextOffset(page.nextOffset);
      notify('History entry deleted.');
    } catch (error) {
      setPageError(error.message);
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

  async function updatePreferences(next) {
    setSettingsBusy(true);
    setSettingsNotice('');
    try {
      await api('/settings/notifications', {
        method: 'PUT',
        body: JSON.stringify({
          inAppEnabled: next.inAppEnabled ?? next.in_app_enabled,
          systemEnabled: next.systemEnabled ?? next.system_enabled,
          emailEnabled: next.emailEnabled ?? next.email_enabled,
        }),
      });
      const updated = await api('/settings/notifications');
      setSettings(updated);
      return true;
    } catch (error) {
      setSettingsNotice(error.message);
      return false;
    } finally {
      setSettingsBusy(false);
    }
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
    if (historyNextOffset === null) return;
    try {
      const page = await api(`/tasks/history?limit=100&offset=${historyNextOffset}`);
      setHistory((items) => [...items, ...page.occurrences]);
      setHistoryNextOffset(page.nextOffset);
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function signOut() {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    setUser(null);
    setTasks([]);
    setNotifications([]);
    setSettings(null);
  }

  if (!authChecked) {
    return <main className="loading-screen"><div className="brand-mark">t</div><p>Getting things ready…</p></main>;
  }
  if (!user) {
    return (
      <AuthScreen
        onSignedIn={setUser}
        darkMode={darkMode}
        onThemeChange={setDarkMode}
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
              <button className="text-button archive-toggle" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? '← Back to active tasks' : 'View archived'}
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
              onChange={updatePreferences}
              onEnableBrowser={enableBrowserNotifications}
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
                {historyNextOffset !== null && (
                  <button className="secondary-button load-more" onClick={loadOlderHistory}>
                    Load older history
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
                        <small>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.created_at))}</small>
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
