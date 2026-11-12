# task_keeper

A personal-first recurring task manager built with JavaScript, React, Node.js/Express, and MongoDB. Create daily, weekly, monthly, and yearly routines; mark each occurrence complete; review missed and completed history; and receive reminders.

## Contents

- [Requirements](#requirements)
- [Configure MongoDB Atlas](#configure-mongodb-atlas)
- [Run in development](#run-in-development)
- [Build and run in production](#build-and-run-in-production)
- [Automated tests](#automated-tests)
- [Working with AI agents](#working-with-ai-agents)
- [Features](#features)
- [Environment variables](#environment-variables)

## Requirements

- Node.js 20.19 or newer (required by the MongoDB Node.js driver)
- npm
- A MongoDB replica set. MongoDB Atlas is supported through an SRV connection string; local development needs a replica-set configuration because the app uses MongoDB transactions.

## Configure MongoDB Atlas

1. In Atlas, create a database user with access to the database this app will use.
2. In Atlas **Network Access**, allow the IP address/network from which the API server will connect. For production, prefer a narrowly scoped network rule over `0.0.0.0/0`.
3. Copy the **Drivers / Node.js** connection string from the Atlas cluster page.
4. Create a private `.env` file in the repository root and set `MONGODB_URI` and `MONGODB_DATABASE=task_keeper` (or your chosen database name).
5. Replace the URI's username, password, and cluster host with the values from your Atlas account. URL-encode reserved characters in the database username/password before putting them in the URI.
6. Set `JWT_SECRET` to a long random value of at least 32 characters.

Keep `.env` private and out of source control. Do not paste database credentials into application code, commit them, or share a populated connection string. If a credential has been exposed, rotate the database user's password in Atlas and update the private `.env`.

The API creates the required MongoDB collections and indexes at startup. Atlas may create the database and collections on first write.

## Run in development

Keep your private `.env` file with your MongoDB URI and JWT secret. Do not commit or share its contents.

Start the app from WSL:

```sh
npm install
docker compose -f compose.redis.yml up -d
npm run dev
```

If you use Windows PowerShell instead, use `npm.cmd` for the npm commands:

```powershell
npm.cmd install
docker compose -f compose.redis.yml up -d
npm.cmd run dev
```

If Docker reports permission denied from WSL, run the Compose command with `sudo`. Redis listens on `localhost:6379`; the Compose service stores its data in a named volume and enables append-only persistence. The server defaults `REDIS_URL` to `redis://localhost:6379`, so no `.env` edit is required for local Redis. Redis remains optional at runtime: when it is unavailable, authentication rate limits use process-local memory and cached reads go directly to MongoDB. Set `REDIS_URL=` in `.env` to disable Redis instead of attempting a connection.

The React frontend is served at `http://localhost:5173`. The Express API listens at `http://localhost:3001`, and Vite proxies `/api` requests to it.

**Network exposure:** The development Vite server is explicitly bound to `0.0.0.0`, and the API also listens on all interfaces by default. Other devices on the same network may be able to reach them. Use development mode only on a trusted network; use HTTPS and production configuration for deployments.

The local servers start even when MongoDB Atlas cannot be reached and retry the database connection every five seconds. If Wi-Fi or internet access drops, the app remains open on localhost, but account and task data needs MongoDB and will be unavailable until the database connection returns.

If Vite starts before the API is listening, the browser retries its initial session check for several seconds. If the API is still unavailable, the sign-in page shows a connection error and a **Retry connection** button.

When switching from WSL to Windows in the same checkout, stop the WSL dev server and run `switch-to-windows.cmd` from the repository root. It removes the workspace links created by WSL and reinstalls Windows-native dependencies. Do not run Windows and WSL installs against the same `node_modules` at the same time.

## Build and run in production

Build the client from the repository root, then start the Express server. When `build/` exists, Express serves both the built frontend and API from the same port (default `3001`).

Windows PowerShell:

```powershell
npm.cmd run build
$env:NODE_ENV = 'production'
npm.cmd start
```

Linux/macOS:

```sh
npm run build
NODE_ENV=production npm start
```

The client build is written to the repository-root `build/` folder, which is ignored by Git. Generate it in the deployment pipeline or deploy it as a build artifact alongside the server; a source checkout by itself does not include the build. Configure `MONGODB_URI` and `JWT_SECRET` through the server environment or a secret manager. Serve the app over HTTPS so production session cookies work securely.

## Automated tests

Run the server regression tests from the repository root:

```sh
npm test
```

The suite uses Node.js's built-in test runner and does not require a MongoDB connection.

## Working with AI agents

[AGENTS.md](./AGENTS.md) summarizes commands, conventions, UI rules, and pitfalls for AI coding agents such as Codex or Copilot.

The repository-shared [task_keeper control skill](./.github/skills/task-keeper-control/SKILL.md) provides a safe, browser-first workflow for frontend testing and task management.

## Features

- User registration and login with bcrypt password hashes, signed HTTP-only JWT cookies, and rate-limited authentication endpoints. Passwords must contain at least 10 characters and no more than 72 UTF-8 bytes, matching bcrypt's input limit. Existing accounts created with longer passwords may need to sign in using the effective first 72 bytes. Bcrypt discarded any suffix when those hashes were created; the app currently has no password-reset flow for passwords whose truncation split a multibyte UTF-8 character.
- Optional Redis-backed shared rate limits for registration and login across API instances, plus a short-lived per-user cache for task lists, history, notifications, and notification settings. Cached responses expire after 10 seconds and are invalidated after relevant writes; without Redis, API reads go directly to MongoDB and rate limits remain in process memory.
- Per-user tasks with title, notes, local due time, and IANA timezone.
- Daily, weekly, monthly, and yearly recurrence.
- Timezone-aware scheduling that retains the local due hour across daylight-saving time changes; nonexistent spring-forward times shift forward by the DST gap (for example, 02:30 becomes 03:30).
- History keeps each occurrence's original timezone when a task's schedule is edited.
- Monthly dates that do not occur in a month (for example, the 31st in February) shift to that month's last day and create a schedule-adjustment notification.
- Yearly tasks reject February 29 and invalid calendar dates.
- Completion on or after an occurrence's local due day, 30-minute snoozes, and missed occurrences that remain actionable until completed or their scheduled local due day ends. Open missed occurrences get repeat reminders every 10 minutes (paused during snooze), then advance automatically when that day ends. Misses remain in history and their notifications are retained. Also includes paginated history, archive, and restore.
- In-app reminders appear in the Notifications view and as a toast while signed in (checked every 15 seconds). The browser tab title shows the unread notification count. After permission is granted, native browser alerts appear for due-task reminders while task_keeper is open; this does not require VAPID keys. Background Web Push and email delivery are server-side integrations and their settings are not exposed in the current UI.
- MongoDB-backed notification delivery outbox with explicit waiting for missing email/push configuration, exponential-backoff retries for delivery failures, and per-subscription progress tracking for push.
- Permanent deletion of archived tasks, history entries, and notifications.
- Clear history removes all completed/missed entries and their linked notifications and delivery records; clear notifications removes all notifications and their associated delivery records.
- Responsive layout with dark mode as the default for new visitors and a saved light/dark theme switch on the sign-in, sign-up, and signed-in pages.

## Environment variables

Required:

| Variable | Description |
| --- | --- |
| `MONGODB_URI` | MongoDB connection URI. Keep Atlas credentials private. |
| `JWT_SECRET` | Session-token signing secret, at least 32 characters. |

General:

| Variable | Default | Description |
| --- | --- | --- |
| `MONGODB_DATABASE` | URI database name, or `task_keeper` | Database name to use. |
| `DB_POOL_MAX` | `10` | MongoDB maximum connection-pool size. |
| `PORT` | `3001` | API listen port. |
| `NODE_ENV` | unset | Set to `production` to enable secure-only session cookies. |
| `ENV_FILE` | project `.env` | Optional path to the environment file. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL for shared authentication rate limits and short-lived API read caching. Set a different URL for hosted Redis, or leave it empty to disable Redis. If Redis is unavailable, the API uses its local fallbacks. |

Optional email settings: `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, and `EMAIL_FROM`.

Optional push settings: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Generate a key pair with:

```powershell
npx web-push generate-vapid-keys
```

Foreground browser alerts require notification permission, a service worker, and In-app reminders enabled. Background push requires HTTPS (except localhost), user permission, a service worker, a browser subscription, and server VAPID configuration. Email and background push wait for missing server configuration and resume when it is available; delivery failures use bounded retries. In-app reminders continue to work.

See [overview.md](./overview.md) for detailed architecture, data model, API routes, dependencies, and scheduler behavior.
