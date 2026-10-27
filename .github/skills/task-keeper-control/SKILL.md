---
name: task-keeper-control
description: 'Use the task_keeper browser UI to test or manage accounts, recurring tasks, snoozes, history, notifications, archive/restore, login/logout, and themes. Use for frontend smoke tests or end-to-end task_keeper operations.'
argument-hint: 'Describe the task_keeper account, workflow, or UI checks'
user-invocable: true
---

# task_keeper Frontend Control

Use the browser UI for requested task_keeper operations and frontend testing. Do not replace user-visible flows with direct API calls or database edits.

## First-run setup and capability check

1. Locate the task_keeper repository root; confirm it contains `package.json`. Read its `README.md` and `AGENTS.md` for current setup and safety notes. Do not assume the current working directory is the repository.
2. Confirm browser-control tools are available and identify the user-provided origin or shared task_keeper tab. For local development, the usual frontend is `http://localhost:5173`, with API health at `http://localhost:3001/api/health`. If browser tools are unavailable, explain that UI testing cannot be performed; do not claim a browser test.
3. If the local app is needed, check whether it is already running before starting it. From the repository root, use `npm.cmd run dev` in Windows PowerShell or `npm run dev` in other shells. Keep a process you start alive while using the app; do not stop an existing process you did not start.
4. Wait for the frontend and API to start and verify the API health endpoint returns `{"status":"ok"}`. If the API is still starting, wait and check its logs/health again before attempting sign-in or registration.
5. If dependencies are missing, use the repository's lockfile and package-manager instructions to install them. If required configuration or database access is missing, report the blocker. Never read, print, or request secrets from `.env`; do not invent configuration values or credentials.
6. Open or reuse the browser page, confirm the page title and origin, and read the current UI before acting. Determine whether someone is already signed in and inspect which view is open. Do not sign out an existing user unless requested.

## UI map (use these exact labels)

- **Auth page**: fields **Email** and **Password** (10–128 chars); submit button is **Sign in** or **Create account**; the mode link at the bottom is **Create an account** / **Sign in**. Errors appear in a `role="alert"` paragraph. The **Dark mode** switch sits at the bottom.
- **Signed-in shell**: sidebar buttons **My tasks**, **History**, **Notifications**, **Sign out**; header button **＋ New task**. The signed-in account email is not always displayed, so confirm sign-in by the sidebar plus the **Your routines** heading.
- **Tasks view** (heading **Your routines**): task cards show title, schedule (`Daily`, `Weekly · Tuesday`, `Monthly · day 31`, `Yearly · 12/25`), notes, a **Next due** or **Snoozed until** value, and buttons **Edit**, **Complete**, **Snooze 30m** (only when due/missed), **Archive**. The **View archived** button toggles an **Archived tasks** list (**← Back to active tasks** returns) whose cards have **Restore** and **Delete permanently**; Edit is disabled there. The **Reminders** panel below the list has **Browser alerts while open** (permission control), **In-app**, **Email**, and **Background push** (VAPID-configured Web Push) settings.
- **New task / Edit task dialog** (`role="dialog"`): **Task name** (required, max 120), **Notes** (optional), **Repeats** (`Every day`, `Every week`, `Every month`, `Every year`), **Due time**, then **Due weekday** (weekly), **Day of month** (monthly), or **Month** and **Day** (yearly). Buttons: **Create task** / **Save changes**, **Cancel**, and **Close** (×). The timezone is read-only text taken from the device; it cannot be chosen in the form. Clicking the backdrop closes the dialog and discards input.
- **History view** (**Task history**): rows show title, `Due …`, and a status of **Completed**, **Completed late**, **Missed**, or **Upcoming**, with a per-row **Delete** button and **Load older history** at the bottom.
- **Notifications view**: each item is a button named `Mark <title> as read` while unread (shows **New**) and a separate `Delete notification: <title>` button.
- **Feedback**: a toast (`role="status"`) disappears after about 3 seconds, so read it immediately after the action and also verify the card/list change. Typical messages: `Task added.`, `Task updated.`, `Nice work. That occurrence is complete.`, `Reminder snoozed for 30 minutes.`, `Task archived. Its history is still available.`, `Task restored.`, `Archived task and its history deleted.`, `History entry deleted.`, `Notification deleted.`. Page-level failures show a dismissible `role="alert"` banner.
- **Native confirm dialogs** (accept to proceed) appear for **Archive**, **Delete permanently**, history **Delete**, and notification **Delete**. **Complete**, **Snooze 30m**, and **Restore** do not ask for confirmation.

## Safety and scope

- Use only an account supplied by the user or explicitly designated for testing. For a broad test with no signed-in test account, create one through the UI using a unique `test-…@example.com` address and a throwaway password; passwords must be 10–128 characters. Never invent credentials for a real account.
- Prefer reusing a designated disposable test account. Authentication is limited to 10 requests per minute: do not create repeated test accounts or rapidly retry failed sign-in/registration. Verify app/API readiness before a single retry.
- Treat tasks, history, notifications, reminder preferences, and account data as user data. Do not mutate existing data unless the user requested that specific operation. For smoke tests, create uniquely named test tasks and only mutate those tasks and test-generated notifications.
- Do not permanently delete tasks, history, notifications, or accounts to clean up a test unless explicitly requested. Never clean up through direct database access. The UI has no account-deletion flow; disclose any test account/data that remains.
- Never ask the user to paste a production password in chat. Have them enter it directly in the browser. Do not include passwords, cookies, tokens, or private account data in logs, screenshots, or summaries.

## Browser interaction and verification

- Prefer accessible roles, labels, and current page references over coordinates. Read the UI after each important action and verify the expected result before continuing.
- Wait for expected values/states after saves instead of using short fixed sleeps. Controls may be disabled during a save; wait for them to become enabled and verify the saved value before another action.
- Browser page references may expire. Reopen the app origin, read the current page, and resume from its actual state. Do not blindly repeat an action because a page or reference disappeared.
- Native confirmation dialogs can interrupt clicks. Use the browser dialog handler and choose according to the requested action. An aborted-request log after handling a dialog does not establish whether the action succeeded; inspect or reload the relevant view.
- Keep actions with confirmations separate; do not combine multiple dialogs or unrelated state changes into one opaque automation sequence.
- If an action's outcome is ambiguous, verify it in the UI or report it as unverified. Do not claim success based only on a click or a request log.

## Account workflows

- Use the sign-in/create-account switch on the auth page as needed. Verify sign-in by checking the authenticated navigation/account state and expected tasks.
- To test login persistence, sign out through the UI, verify the auth form appears, reload and verify the signed-out state remains, then sign in through the UI and verify the expected account/tasks return.
- Do not sign out an existing user merely to test authentication unless requested; use a designated test account.

## Task workflows

Task schedules use the device timezone (not editable) and default new tasks to 10 minutes from the current device time. Daily, weekly, monthly, and yearly schedules are supported. The first occurrence is today if its scheduled time is still ahead; otherwise it starts at the next matching schedule. Set **Due time** explicitly when timing matters.

1. Create a uniquely named task (for example, `Smoke Daily <yyyymmdd-hhmm>`) through **＋ New task** or **Create your first task**. Fill the labeled fields from the UI map, submit with **Create task**, and verify the new card and its schedule text. Weekly tasks need a weekday; monthly tasks need a day; yearly tasks need a month and day.
2. For recurrence coverage, create one test task for each frequency. The **Day of month** list only offers days that exist in the current month, so day 31 is selectable only in 31-day months; a saved day 31 is shown with a short-month note. The yearly **Day** list caps February at 28, so Feb 29 cannot be chosen. Monthly day 31 clamps to the final day of shorter months and can produce a schedule-adjustment notification.
3. Edit only a task created for this test (or the specific task the user asked to edit). Verify the updated title/details in its card after the save completes.
4. Complete a designated test occurrence and verify its success feedback and History entry. Only test snooze on a test task whose occurrence is due/missed; the control is intentionally unavailable earlier. Verify the displayed “Snoozed until” value. Each snooze adds 30 minutes from the later of now or the existing snooze deadline.
5. Archive only a designated test task. Verify it disappears from active tasks and appears under **View archived**. Restore it and verify it returns to the active list.
6. Permanent deletion is irreversible. Do it only when the user explicitly requests it for a deliberately disposable test task, and verify removal.

## Recommended smoke-test sequence

Use when asked to "test the frontend" without finer detail. Keep a short running log of each step and its observed result.

1. Complete the first-run setup, then reach a designated test account (sign in, or register once with a unique `test-…@example.com`). Verify the **Your routines** heading.
2. Create one task per frequency with unique names; verify each card.
3. Edit one task's title and notes; wait for `Task updated.` and the new title on the card.
4. Create a daily task due 2–3 minutes from now. Wait for the scheduler (ticks every 15 seconds) to mark it missed, then verify a reminder in **Notifications** and **Snooze 30m** on the card. Snooze once and verify **Snoozed until**. Complete it, then verify **Completed late** in **History**.
5. Mark only the notification created by this test as read.
6. Archive one test task (accept the confirm), verify it in **View archived**, restore it, verify it is back.
7. Toggle the theme, reload, and verify it persisted; set it back.
8. Sign out, verify the auth form, reload to confirm it stays signed out, then sign in again and verify the tasks are still there.
9. Report results using the format in **Finish and report**.

## History, notifications, and preferences

- Inspect **History** for the test account and verify the expected completed/missed occurrences. Load older history only when needed. Deleting history also removes linked notifications; get explicit confirmation before doing so.
- In-app notifications are polled while signed in (approximately every 15 seconds). Foreground browser alerts require permission granted through **Enable browser notifications**, In-app reminders enabled, and task_keeper open. For reminder tests, create a test occurrence due soon or wait until a test occurrence becomes missed. Background push and email require server configuration; do not claim their delivery unless configured and actually observed.
- Inspect **Notifications** without changing existing items. Clicking an unread notification marks it read; only mark a notification generated by the current test as read, unless the user requested otherwise. Confirm before deleting a notification.
- Email and browser push may be unavailable. Report the availability and configuration notices shown under **Reminders**; unavailable external delivery is not a frontend failure.
- Preserve reminder preferences during smoke tests. Before testing a toggle, record its initial value, wait for the save to finish, restore the original value, and verify it after reload.

## Theme and responsive UI checks

- Dark mode is the default when no preference is saved; saved light/dark preferences should persist through navigation and reload.
- Inspect auth and signed-in views at about 390 px and desktop width when responsive behavior is in scope. Check horizontal overflow with `document.documentElement.scrollWidth <= document.documentElement.clientWidth`, and ensure cards/dialogs fit.
- The theme switch is in normal document flow, not fixed/sticky. On long pages scroll `.theme-footer` into view before judging whether it is visible. Restore any theme preference you changed.

## Finish and report

- Verify requested outcomes in the UI. Leave the app in a useful state, normally the task list or signed-out auth page depending on the request.
- Report as a short table or list of **step → result (passed, failed, or not tested) → evidence** (for example, the visible card text or toast). Include any UI defects found with the view, steps to reproduce, and viewport/theme.
- Summarize the flows tested and their visible results. State any unavailable browser, server, database, email, or push capability plainly; distinguish verified behavior from assumptions.
- Disclose any test account or test data that remains and why it could not be removed through the UI. Do not claim external notification delivery or account cleanup that was not verified.
