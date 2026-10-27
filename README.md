# task_keeper

A personal-first recurring task manager built with JavaScript, React, Node.js/Express, and MongoDB. Create daily, weekly, monthly, and yearly routines; mark each occurrence complete; review missed and completed history; and receive reminders.

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

## Install and run

```powershell
npm install
npm run dev
```

The React frontend is served at `http://localhost:5173`. The Express API listens at `http://localhost:3001`, and Vite proxies `/api` requests to it.

To build the client and serve the production build through Express:

```powershell
npm run build
npm start
```

The server serves `client/dist` if the production build exists.

## Working with AI agents

[AGENTS.md](./AGENTS.md) summarizes commands, conventions, UI rules, and pitfalls for AI coding agents such as Codex or Copilot.

The repository-shared [task_keeper control skill](./.github/skills/task-keeper-control/SKILL.md) provides a safe, browser-first workflow for frontend testing and task management.

## Features

- User registration and login with bcrypt password hashes, signed HTTP-only JWT cookies, and rate-limited authentication endpoints.
- Per-user tasks with title, notes, local due time, and IANA timezone.
- Daily, weekly, monthly, and yearly recurrence.
- Timezone-aware scheduling that retains the local due hour across daylight-saving time changes.
- Monthly dates that do not occur in a month (for example, the 31st in February) shift to that month's last day and create a schedule-adjustment notification.
- Yearly tasks reject February 29 and invalid calendar dates.
- Completion, 30-minute snoozes, missed occurrences, repeat reminders every 10 minutes while a missed occurrence remains open (pausing during snooze), paginated history, archive, and restore.
- In-app reminders appear in the Notifications view and as a toast while signed in (checked every 15 seconds). The browser tab title shows the unread notification count. After permission is granted, native browser alerts appear for due-task reminders while task_keeper is open; this does not require VAPID keys. Background Web Push and email delivery are server-side integrations and their settings are not exposed in the current UI.
- MongoDB-backed notification delivery outbox with retries for email and browser push.
- Permanent deletion of archived tasks, history entries, and notifications.
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

Optional email settings: `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_SECURE`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, and `EMAIL_FROM`.

Optional push settings: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Generate a key pair with:

```powershell
npx web-push generate-vapid-keys
```

Foreground browser alerts require notification permission, a service worker, and In-app reminders enabled. Background push requires HTTPS (except localhost), user permission, a service worker, a browser subscription, and server VAPID configuration. Email and background push remain queued for retry when their server configuration is incomplete; in-app reminders continue to work.

See [overview.md](./overview.md) for detailed architecture, data model, API routes, dependencies, and scheduler behavior.
