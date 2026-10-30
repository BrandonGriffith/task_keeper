# task_keeper Project Overview

## Purpose

`task_keeper` is a personal-first recurring-task manager. It helps people keep daily, weekly, monthly, and yearly routines in view, records whether individual scheduled occurrences were completed or missed, and creates reminders when an occurrence becomes due.

The application is written in JavaScript and Node.js. It consists of a React browser client, an Express API, and MongoDB persistence. The API process also runs the background scheduler that creates occurrences and dispatches notifications.

## Current technology and requirements

- Node.js 20.19 or newer and npm.
- A MongoDB replica set, either MongoDB Atlas or a local replica-set deployment. The application uses multi-document transactions.
- React 19 and Vite 6 for the browser client.
- Express 5 for the API.
- MongoDB Node.js driver 7 for persistence.

MongoDB driver 7 requires Node.js 20.19 or later. A standalone local `mongod` is not sufficient for the app's transaction-based task and reminder operations.

## Features and behavior

### Accounts and sessions

- Account registration, sign-in, session lookup, and sign-out.
- Email addresses are trimmed and normalized to lowercase.
- Passwords must contain 10–128 characters and are stored as bcrypt hashes.
- Authentication uses a signed JSON Web Token in an HTTP-only cookie. The cookie is `SameSite=Lax`, valid for seven days, and marked `Secure` in production.
- Registration and login are limited to 10 requests per minute.
- Authenticated user-data access is scoped to the current user ID; system-wide scheduler operations use separate coordination records.
- Each user document stores their in-app, system-push, and email notification preferences.

### Recurring tasks

Tasks have a title, optional notes, frequency, local due time, timezone, and recurrence-specific settings.

| Frequency | Schedule |
| --- | --- |
| Daily | Every local calendar day at the selected time |
| Weekly | On a selected weekday at the selected time |
| Monthly | On a selected day of the month at the selected time |
| Yearly | On a selected month and day at the selected time |

Additional scheduling behavior:

- New tasks default to a due time 10 minutes from the current device time; the browser's local timezone is used. The first occurrence is today if its scheduled time has not passed yet, otherwise it begins at the next matching schedule.
- Server validation checks required recurrence fields, title and notes length, due-time format, timezone identifiers, and valid yearly calendar dates.
- Monthly dates unavailable in a particular month are clamped to that month's final day. For example, a task scheduled on the 31st occurs on February's final day. The app records the adjustment and creates a schedule-adjustment notification.
- February 29 is excluded from yearly schedules.
- Recurrences are calculated in the schedule's IANA timezone so the local due hour remains stable across daylight-saving transitions.
- Users can create, edit, complete, snooze, archive, and restore tasks.
- Editing a task supersedes already-due open occurrences, clears their snoozes, and replaces future occurrences for the old schedule while preserving completed history.
- Archiving hides a task from the active list without deleting its occurrences or history. Archived tasks can be permanently deleted, along with their occurrences, linked notifications, and pending notification deliveries.
- Individual history entries and in-app notifications can be deleted from their respective views, and each view can be cleared in full. Clearing history also deletes notifications and pending deliveries linked to those occurrences; clearing notifications removes all of the user's notifications and pending deliveries.

### Occurrences, missed work, and history

A task is the recurring schedule; an occurrence is one scheduled instance. Occurrence documents keep snapshots of the task title, timezone, and due instant, plus lifecycle state, snooze state, and reminder timestamps. History uses the timezone saved with each occurrence so editing a task's timezone does not change how earlier dates are displayed.

- New occurrences start as `pending`.
- When a due time passes without completion or an active snooze, the scheduler marks the occurrence `missed`, records `missedAt`, and creates a reminder. A pending occurrence already snoozed is skipped until the snooze expires.
- Open missed occurrences generate another reminder every 10 minutes from the last reminder. Snoozing pauses repeats until the snooze expires; the snooze-expiry reminder restarts the interval. The scheduler checks every 15 seconds, so reminders can arrive just after the 10-minute boundary. Completing the occurrence stops reminders.
- Pending or missed occurrences can be completed. Completing an occurrence advances the task to its next open occurrence.
- Each snooze click adds 30 minutes to the later of the existing snooze deadline or the current time. The task card shows the updated deadline, and the scheduler creates a follow-up reminder when it arrives.
- Editing a task supersedes any already-due open occurrence and clears its snooze, while retaining the missed occurrence in history. Future occurrences for the old schedule are removed and replaced with the edited schedule.
- The history view lists completed and missed occurrences newest first and supports offset pagination.
- Archived tasks remain in the database, so their history remains accessible.

### Notifications

The application supports three notification channels:

1. **In-app and foreground browser alerts:** Durable notification documents are stored in MongoDB and displayed in the Notifications view. While signed in, the browser checks for new notifications every 15 seconds and refreshes the task list when one arrives. The browser tab title shows the current unread notification count. After the user grants browser notification permission, due-task reminders appear as native browser alerts while task_keeper is open. If alerts have not been enabled, a toast appears while the app tab is visible. Foreground alerts use the service worker and require In-app reminders to be enabled; they do not require VAPID configuration.
2. **Email:** Optional delivery through SMTP using Nodemailer.
3. **Background browser push:** Optional Web Push delivery using VAPID, the browser Push API, and a service worker. This can deliver while the app tab is closed.

Email and background push are optional server-side integrations; their settings are not exposed in the current UI yet. If configuration is missing, delivery stays queued for a later retry and in-app reminders remain available. Foreground browser alerts require notification permission, a service worker, and In-app reminders enabled. Background browser push requires HTTPS (localhost is allowed), browser notification permission, a service worker, a registered subscription, and configured VAPID keys. Push endpoints are validated against supported secure browser notification services.

External notification deliveries use separate MongoDB documents with `pending`, `sending`, `sent`, or `failed` state, retry time, attempt count, and last error. Expired subscriptions that return HTTP 404 or 410 are removed.

## Architecture and repository layout

The root package uses npm workspaces to coordinate the client and server:

```text
.
├── client/
│   ├── public/
│   │   ├── icon.svg
│   │   └── sw.js
│   ├── src/
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   └── package.json
├── server/
│   ├── src/
│   │   ├── app.js
│   │   ├── auth.js
│   │   ├── config.js
│   │   ├── db.js
│   │   ├── errors.js
│   │   ├── index.js
│   │   ├── notifications.js
│   │   ├── recurrence.js
│   │   ├── scheduler.js
│   │   ├── tasks.js
│   │   └── validation.js
│   └── package.json
├── .gitignore
├── AGENTS.md
├── package.json
├── package-lock.json
├── README.md
└── overview.md
```

`AGENTS.md` is the quick-start for AI coding agents (commands, conventions, pitfalls). `overview.md` is the full reference.

### Client

- `client/src/App.jsx` implements account forms, task creation/editing, active/archived lists, task actions, history, notifications, and in-app/foreground browser reminder settings. Email and background push remain server-side integrations without UI controls.
- `client/src/api.js` is the same-origin JSON API helper and converts a VAPID base64url key to the browser Push API's byte format.
- `client/src/main.jsx` mounts React.
- `client/src/styles.css` contains the responsive application styling and light/dark color palettes.
- Dark mode is the default when no browser theme preference is saved. The theme toggle appears at the bottom of the sign-in/sign-up screen and each signed-in page; the selection is saved in browser local storage (`theme`) and applied as `data-theme` on `<html>`.
  - The control is an accessible checkbox with `role="switch"` and the label "Dark mode", inside `<footer class="theme-footer">`.
  - The footer is in normal document flow on every viewport (it sits after the page content). It must not be `position: fixed` or sticky: that previously covered content or hid the switch on mobile.

#### Design system (`styles.css`)

- Colors are CSS custom properties on `:root`, with dark overrides under `:root[data-theme='dark']`. Base tokens: `--green`, `--ink`, `--muted`, `--line`, `--paper`, `--canvas`, `--surface`.
- Accent tokens: `--accent-teal`, `--accent-blue`, `--accent-violet`, `--accent-amber`, `--accent-coral` plus `*-soft` backgrounds. Task cards cycle teal/blue/violet/amber through `--task-accent`; missed tasks use coral. History and Notifications nav tabs use blue and violet.
- Prefer these tokens (with `color-mix`) over hard-coded hex values so both themes stay consistent.
- Dark mode uses a near-black canvas and gray (not white) text, while keeping colored accents.
- The mobile layout is a single column at `max-width: 740px` with a compact header (brand and sign-out on one row, nav on the next). Avoid shrinking it into a narrow "box".
- `client/public/sw.js` handles push events and notification clicks.
- `client/index.html` is the Vite HTML entry point.

### Server

- `server/src/index.js` checks runtime configuration, connects to MongoDB before opening the HTTP listener, starts the scheduler, and closes the scheduler and database connection on shutdown.
- `server/src/app.js` configures Express, JSON parsing, cookies, the database health check, API routers, and production static-file serving.
- `server/src/auth.js` implements registration/login/logout/session lookup, password hashing, signed cookies, authentication middleware, and rate limiting.
- `server/src/db.js` owns the MongoDB client lifecycle, selected database, and startup index creation.
- `server/src/tasks.js` implements task/occurrence APIs, response mapping, user ownership checks, and lifecycle updates.
- `server/src/recurrence.js` calculates timezone-aware first and subsequent occurrences.
- `server/src/scheduler.js` fills the occurrence schedule, creates initial, snooze-expiry, and 10-minute repeat reminders for open missed occurrences, and processes email/push delivery documents.
- `server/src/notifications.js` implements notification queries, read state, preferences, and push subscriptions.
- `server/src/validation.js` validates task input and calendar constraints.
- `server/src/config.js` loads `.env` and validates required/optional runtime configuration.
- `server/src/errors.js` formats validation, HTTP, and unexpected errors as JSON responses.

## MongoDB data model

The server uses the official MongoDB Node.js driver directly. Documents use UUID strings as `_id` values and camelCase fields internally. API response mapping preserves the existing frontend's snake_case field names where expected. Task creation/editing/completion and reminder creation use MongoDB transactions to keep related task, occurrence, and notification records consistent. The application creates indexes at startup; there is no SQL migration to run.

### Collections

| Collection | Purpose |
| --- | --- |
| `users` | Email, password hash, user ID, creation time, and embedded notification preferences |
| `tasks` | User-owned recurrence definitions, timezone, next due instant, and archive state |
| `occurrences` | Scheduled task instances, task-title snapshot, status, due time, completion/missed/superseded timestamps, snooze state, and last-reminder time |
| `notifications` | In-app notifications and read state; optionally linked to an occurrence |
| `pushSubscriptions` | Browser subscriptions keyed by endpoint and owner |
| `notificationDeliveries` | Retryable per-channel email/push outbox records |
| `schedulerLocks` | Lease used to coordinate a scheduler tick across API instances |

### Indexes

`connectToDatabase()` creates the following indexes:

- Unique normalized user email.
- Task lookup by owner, archive state, and next due time.
- Unique occurrence per task and due instant.
- Occurrence lookup by task/status/due time; by user/history ordering; by status/due/notification state; and by status/snooze time.
- Notification lookup by owner and creation time.
- Unique occurrence/kind notification for records linked through `occurrenceId` (schedule-adjustment notifications). Task reminders use `sourceOccurrenceId` and are coordinated by the scheduler lease instead.
- Unique push endpoint and push subscriptions by owner.
- Unique notification/channel delivery and delivery queue lookup by status/retry/update times.

MongoDB does not use relational foreign keys. The API scopes documents by `userId`, and the scheduler uses explicit lookups between user, task, occurrence, notification, and delivery documents. Task archival is logical: it does not delete related documents.

## API overview

All endpoints use the `/api` prefix and return JSON except where noted. In development, Vite proxies API requests to Express. Authenticated routes use the `task_keeper_session` cookie.

### Health and authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Pings MongoDB |
| `POST` | `/api/auth/register` | Creates an account and session |
| `POST` | `/api/auth/login` | Authenticates and starts a session |
| `POST` | `/api/auth/logout` | Clears the session cookie |
| `GET` | `/api/auth/me` | Returns the signed-in user |

### Tasks and occurrences

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tasks` | Lists active tasks |
| `GET` | `/api/tasks?archived=true` | Lists archived tasks |
| `POST` | `/api/tasks` | Creates a recurring task |
| `PATCH` | `/api/tasks/:id` | Updates a task and its open future schedule |
| `DELETE` | `/api/tasks/:id` | Archives a task without deleting history |
| `DELETE` | `/api/tasks/:id/permanent` | Permanently deletes an archived task and its related records |
| `POST` | `/api/tasks/:id/restore` | Restores an archived task |
| `GET` | `/api/tasks/history?limit=100&offset=0` | Lists occurrence history; limit is 1–200 |
| `DELETE` | `/api/tasks/history` | Clears all history occurrences and their linked notifications and pending deliveries |
| `DELETE` | `/api/tasks/history/:id` | Deletes a history occurrence and its linked notifications |
| `POST` | `/api/tasks/occurrences/:id/complete` | Completes an open occurrence |
| `POST` | `/api/tasks/occurrences/:id/snooze` | Snoozes an open occurrence for 30 minutes |

### Notifications and preferences

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/notifications` | Lists the most recent 100 in-app notifications |
| `DELETE` | `/api/notifications` | Clears all in-app notifications and their pending channel deliveries |
| `PATCH` | `/api/notifications/:id/read` | Marks a notification as read |
| `DELETE` | `/api/notifications/:id` | Deletes a notification and its pending channel deliveries |
| `GET` | `/api/settings/notifications` | Reads preferences and channel availability |
| `PUT` | `/api/settings/notifications` | Updates notification preferences |
| `POST` | `/api/push-subscriptions` | Registers or updates a browser subscription |
| `DELETE` | `/api/push-subscriptions` | Removes the signed-in user's browser subscription |

## Background scheduler

The API process runs the reminder scheduler; it does not need a separate worker. It runs once at startup and then every 15 seconds. A MongoDB lease in `schedulerLocks` prevents concurrent scheduler ticks across API instances; the lease is refreshed while a tick is running and released when the tick finishes.

Each scheduler tick:

1. Creates occurrences for active tasks that lack an open future occurrence, maintaining a future occurrence and a rolling seven-day schedule horizon.
2. Marks due, unnotified occurrences as missed and creates reminders plus delivery records for enabled external channels.
3. Creates a reminder when a snooze expires. If the occurrence remains missed and open, it gets another reminder every 10 minutes; snoozing pauses that interval and expiry starts it over.
4. Claims eligible email/push delivery records, dispatches them, and records success or retry state.

The API process must remain running for scheduler reminders to be processed. When the app is open and signed in, the browser checks for in-app reminders every 15 seconds. Email and push delivery requires the corresponding server configuration and enabled user preference. Unique task/occurrence and notification/delivery indexes protect their respective records; reminder creation is coordinated by the scheduler lease. Local deployments need replica-set mode for transactions; MongoDB Atlas clusters provide replica-set transaction support.

## Dependencies

The root `package-lock.json` captures exact resolutions. Versions below are the direct dependency versions resolved in the current installed project; `package.json` files declare semver ranges.

### Application dependencies

| Workspace | Package | Resolved version | Purpose |
| --- | --- | ---: | --- |
| `client` | `react` | 19.3.1 | Browser UI and component state |
| `client` | `react-dom` | 19.3.1 | Mounts React into the browser DOM |
| `client` | `vite` | 6.4.5 | Development server and production bundler |
| `client` | `@vitejs/plugin-react` | 4.7.0 | React support in Vite |
| `server` | `express` | 5.3.0 | HTTP server and API routing |
| `server` | `mongodb` | 7.7.0 | MongoDB client and connection pool |
| `server` | `bcryptjs` | 3.0.3 | Password hashing and verification |
| `server` | `jsonwebtoken` | 9.0.3 | Session JWT signing and verification |
| `server` | `cookie-parser` | 1.4.7 | Reads the session cookie |
| `server` | `express-rate-limit` | 7.5.1 | Limits account registration and login rates |
| `server` | `zod` | 4.6.7 | API input validation |
| `server` | `dotenv` | 16.6.1 | Loads local environment variables |
| `server` | `nodemailer` | 10.2.1 | SMTP email delivery |
| `server` | `web-push` | 3.6.7 | VAPID browser push delivery |

### Development dependencies

| Workspace | Package | Resolved version | Purpose |
| --- | --- | ---: | --- |
| root | `concurrently` | 9.2.5 | Runs the frontend and API dev processes together |

The client uses CSS and standard browser APIs. The server and client also use Node.js/browser built-ins without additional packages, including HTTP, cryptography through dependency APIs, `Intl.DateTimeFormat`, service workers, notifications, and push subscriptions.

## Configuration

Create a private `.env` file in the project root; `.env` is local configuration and must not be committed. The server loads it from the project root, or from the path specified by `ENV_FILE`.

### Required settings

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection URI, such as an Atlas SRV URI |
| `JWT_SECRET` | Session-signing secret of at least 32 characters |

### General settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_DATABASE` | URI database name, otherwise `task_keeper` | Database to select |
| `DB_POOL_MAX` | `10` | MongoDB maximum connection pool size |
| `PORT` | `3001` | API port |
| `NODE_ENV` | unset | `production` enables secure-only session cookies |
| `ENV_FILE` | project `.env` | Optional environment file location |

### Optional email settings

`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, and `EMAIL_FROM` configure SMTP. Email is considered configured when host, a valid port, and sender are supplied; a password is required if a username is set.

### Optional browser push settings

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` configure Web Push. The private key must remain secret. Generate a key pair with `npx web-push generate-vapid-keys`.

## Local development and production

### MongoDB Atlas

1. Create a database user in Atlas with access to the application's database.
2. Add the API server's IP/network to the Atlas Network Access allowlist.
3. Copy the Node.js driver URI from Atlas.
4. Create a private `.env` file; set `MONGODB_URI`, `MONGODB_DATABASE`, and a long random `JWT_SECRET`.
5. URL-encode any reserved characters in the database username or password used in the connection URI.
6. Install dependencies and start the app:

   ```powershell
   npm install
   npm run dev
   ```

The frontend runs at `http://localhost:5173` and the API at `http://localhost:3001`.

The API begins listening before connecting to MongoDB and retries an unavailable database connection every five seconds. This keeps the local app available when Wi-Fi or internet access drops, but account and task operations still require the MongoDB database and resume when it is reachable again.

For a single-process production deployment, build the client, then start Express with `NODE_ENV=production`:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

The production client is built into the repository-root `build/` folder, which Express serves with the API on the configured `PORT` (default `3001`) when the build exists. This folder is ignored by Git and must be generated with `npm run build` on the deployment host or included as a deployment artifact alongside the server. Provide `MONGODB_URI` and `JWT_SECRET` through the server environment or a secret manager. Production deployments should use HTTPS, persistent MongoDB Atlas, restricted network access, backups, and monitoring for the API and scheduler.

## Scripts

Run from the repository root:

| Command | Effect |
| --- | --- |
| `npm run dev` | Starts the API in Node watch mode and the Vite development server |
| `npm run build` | Builds the React client into the repository-root `build/` folder |
| `npm start` | Starts the API, MongoDB client, and reminder scheduler |

This repository currently has no automated test suite. Use `npm run build` for client build validation and the browser-control skill for safe, user-visible workflow checks. Verify API behavior with the running app when the change affects server routes or scheduling.

On Windows, if PowerShell blocks the `npm.ps1` shim, run commands as `npm.cmd run dev`, `npm.cmd run build`, and similar.

## Known gotchas

- `.env` contains private configuration and is git-ignored. Never print, commit, or copy it.
- Date/time bugs are the most likely regressions. Test editing a task after it was snoozed or missed (snooze must clear, stale occurrences must be superseded).
- Users should never see raw server errors. The client shows short friendly messages (`pageError` banner); see `errors.js` for the server side.
- The workspace was not under Git until late in development. If an editor shows "changes … were … Keep/Undo" errors, the editor's change tracking is stale; the file on disk is authoritative.

## Product scope

The current product is a personal task manager. Each account has private tasks; shared tasks, teams, and collaboration are not currently implemented.
