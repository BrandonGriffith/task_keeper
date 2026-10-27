# AGENTS.md

Guidance for AI coding agents (Codex, Copilot, Claude, etc.) working on task_keeper. For the full reference, see [overview.md](./overview.md). For setup, see [README.md](./README.md).

## What this is

A personal recurring-task manager (daily, weekly, monthly, yearly) with missed-task reminders. JavaScript only: React 19 + Vite client, Express 5 API, MongoDB Atlas, npm workspaces (`client`, `server`).

## Commands (run from the repo root)

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Run everything (API :3001 + web :5173) | `npm run dev` |
| Production build | `npm run build` |
| Tests (API must be running) | `npm test` |

On Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked. PowerShell has no `&&`; chain with `;`.

## Before you start

1. `.env` must exist (copy `.env.example`). It contains real Atlas credentials: never print, log, commit, or paste it.
2. Check whether the app is already running: `curl http://localhost:3001/api/health` should return `{"status":"ok"}`.
3. Run `git status` and `git log` to see the current state. Commit meaningful changes.

## Where things live

- `server/src/tasks.js`: task/occurrence routes and lifecycle (create, edit, snooze, complete, archive, delete).
- `server/src/scheduler.js`: 15-second tick that creates occurrences, marks missed, and creates and sends notifications.
- `server/src/recurrence.js`: timezone-aware next-due calculation.
- `server/src/notifications.js`: in-app notifications, preferences, push subscriptions.
- `server/test/api.test.js`: end-to-end API tests.
- `client/src/App.jsx`: the whole UI (auth, tasks, history, notifications, theme switch).
- `client/src/styles.css`: all styling, with CSS-variable light and dark themes.

## Conventions

- Mongo documents use UUID string `_id` and camelCase fields. API responses use snake_case; keep that mapping.
- Multi-document changes use `withMongoTransaction` (needs an Atlas or replica-set MongoDB).
- Every query is scoped by `userId`. Never return or modify another user's data.
- Input validation uses zod in `server/src/validation.js`.
- Users must never see raw server or stack errors. Show short friendly messages.
- Keep changes surgical. Update `overview.md` and `README.md` when behavior, routes, or setup change.

## UI rules (the user cares about these)

- Mobile must remain a full-width single column. Do not shrink it into a small box or leave large empty areas.
- Dark mode is the default when no theme preference is saved. The switch lives in `.theme-footer` at the bottom of sign-in/sign-up and signed-in pages, in normal flow. Do not make it `fixed` or `sticky`: that has repeatedly covered content or hidden it.
- Dark mode uses gray text (not white) and keeps colored accents. Reuse the `--accent-*` and `--task-accent` tokens instead of hard-coded hex.
- Verify UI changes at about 390 px and desktop widths, in both themes, on Tasks, History, and Notifications.

## Testing notes

- `npm test` hits the real Atlas database with throwaway `test-…@example.com` users and cleans up. Auth is rate limited to 10 requests per minute, so wait about a minute between runs.
- Editing server files restarts the API (`node --watch`); wait for "API listening" before running tests.
- Verified flows to keep working: register/login, create tasks of all four frequencies, edit after snooze or missed (no stale "snoozed until" or "missed occurrence"), repeated 30-minute snoozes, complete, delete history/notifications/archived tasks.

## Pitfalls

- Editing a task must supersede open occurrences and clear snoozes (previous bugs: stale snooze time and ghost missed occurrences).
- Monthly day 31 clamps to the month's last day and creates a schedule-adjustment notification. Yearly Feb 29 is rejected.
- `node --test test/` fails on Node 24; the test script names the file explicitly.
- Clean up any test data or scratch scripts you create (do not leave test users in the database).
