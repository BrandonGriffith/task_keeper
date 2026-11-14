import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'task_keeper_architecture_dependencies.pdf');
const pageWidth = 612;
const pageHeight = 792;
const margin = 42;
const contentWidth = pageWidth - margin * 2;
const updatedDate = new Date().toISOString().slice(0, 10);
const colors = {
  ink: '26352F',
  muted: '697870',
  line: 'DCE3DE',
  paper: 'FFFFFF',
  canvas: 'F5F7F4',
  green: '285545',
  deep: '193C32',
  teal: '397E78',
  blue: '5876AD',
  violet: '8064A7',
  amber: 'AD7842',
  lightGreen: 'EAF1EC',
  lightBlue: 'EDF1FA',
  lightAmber: 'F8F1E7',
};

function rgb(hex) {
  return hex.match(/[0-9A-F]{2}/gi).map((part) => Number.parseInt(part, 16) / 255);
}

function pdfNumber(number) {
  return Number(number.toFixed(2)).toString();
}

function escapePdfText(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function charWidth(character) {
  if (" ilI.,:;!'|".includes(character)) return 0.25;
  if ('MW@%&'.includes(character)) return 0.82;
  if ('ABCDEFGHKNOPQRSTUVXYZ'.includes(character)) return 0.64;
  if ('0123456789'.includes(character)) return 0.55;
  if ('-_/()[]'.includes(character)) return 0.34;
  return 0.51;
}

function wrapText(value, width, fontSize) {
  const limit = (width / fontSize) * 0.94;
  const lines = [];
  let line = '';
  let measured = 0;

  for (const word of value.split(/\s+/)) {
    const wordWidth = [...word].reduce((sum, character) => sum + charWidth(character), 0);
    if (line && measured + charWidth(' ') + wordWidth > limit) {
      lines.push(line);
      line = word;
      measured = wordWidth;
    } else {
      line += `${line ? ' ' : ''}${word}`;
      measured += (line === word ? 0 : charWidth(' ')) + wordWidth;
    }

    while (measured > limit && line.length > 1) {
      let splitAt = 1;
      let splitWidth = charWidth(line[0]);
      while (splitAt < line.length && splitWidth + charWidth(line[splitAt]) <= limit) {
        splitWidth += charWidth(line[splitAt]);
        splitAt += 1;
      }
      lines.push(line.slice(0, splitAt));
      line = line.slice(splitAt);
      measured = [...line].reduce((sum, character) => sum + charWidth(character), 0);
    }
  }
  if (line) lines.push(line);
  return lines;
}

class Page {
  constructor({ cover = false, number = 1 } = {}) {
    this.commands = [];
    this.number = number;
    if (cover) {
      this.rect(0, 0, pageWidth, pageHeight, colors.deep);
      this.rect(0, 0, 9, pageHeight, colors.teal);
    } else {
      this.rect(0, 0, pageWidth, pageHeight, colors.canvas);
      this.text(margin, 25, 'TASK_KEEPER  /  ARCHITECTURE & DEPENDENCIES', 8, 'bold', colors.green);
      this.text(pageWidth - margin - 72, 25, 'CURRENT GUIDE', 7.5, 'bold', colors.muted);
      this.line(margin, 42, pageWidth - margin, 42, colors.line, 0.7);
      this.line(margin, 757, pageWidth - margin, 757, colors.line, 0.7);
      this.text(margin, 768, `task_keeper  |  System guide  |  Updated ${updatedDate}`, 7.5, 'regular', colors.muted);
      this.text(pageWidth - margin - 33, 768, `${number} / 6`, 7.5, 'bold', colors.green);
    }
  }

  text(x, top, value, size = 10, font = 'regular', color = colors.ink) {
    const [red, green, blue] = rgb(color);
    const y = pageHeight - top - size;
    this.commands.push(
      `BT /${font === 'bold' ? 'F2' : 'F1'} ${pdfNumber(size)} Tf ${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} rg 1 0 0 1 ${pdfNumber(x)} ${pdfNumber(y)} Tm (${escapePdfText(String(value))}) Tj ET`,
    );
  }

  rect(x, top, width, height, fill, stroke, lineWidth = 1) {
    const y = pageHeight - top - height;
    if (stroke) {
      const [red, green, blue] = rgb(stroke);
      this.commands.push(
        `q ${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} RG ${pdfNumber(lineWidth)} w ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re S Q`,
      );
    }
    if (fill) {
      const [red, green, blue] = rgb(fill);
      this.commands.push(
        `q ${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} rg ${pdfNumber(x)} ${pdfNumber(y)} ${pdfNumber(width)} ${pdfNumber(height)} re f Q`,
      );
    }
  }

  line(x1, top1, x2, top2, color = colors.line, lineWidth = 1) {
    const [red, green, blue] = rgb(color);
    this.commands.push(
      `q ${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} RG ${pdfNumber(lineWidth)} w ${pdfNumber(x1)} ${pdfNumber(pageHeight - top1)} m ${pdfNumber(x2)} ${pdfNumber(pageHeight - top2)} l S Q`,
    );
  }

  arrow(x1, top, x2, color = colors.teal) {
    this.line(x1, top, x2 - 7, top, color, 1.5);
    const [red, green, blue] = rgb(color);
    const y = pageHeight - top;
    this.commands.push(
      `q ${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)} rg ${pdfNumber(x2 - 7)} ${pdfNumber(y + 4)} m ${pdfNumber(x2)} ${pdfNumber(y)} l ${pdfNumber(x2 - 7)} ${pdfNumber(y - 4)} l h f Q`,
    );
  }

  paragraph(x, top, width, value, {
    size = 9.5,
    leading = size * 1.45,
    font = 'regular',
    color = colors.ink,
  } = {}) {
    const lines = wrapText(value, width, size);
    lines.forEach((line, index) => this.text(x, top + index * leading, line, size, font, color));
    return top + lines.length * leading;
  }

  bullet(x, top, width, value, { size = 9.2, leading = size * 1.42, color = colors.ink } = {}) {
    this.rect(x, top + 5, 5, 5, colors.teal);
    return this.paragraph(x + 13, top, width - 13, value, { size, leading, color });
  }

  card(x, top, width, height, { fill = colors.paper, stroke = colors.line } = {}) {
    this.rect(x, top, width, height, fill, stroke, 0.7);
  }

  table(x, top, widths, headers, rows, { fontSize = 8.3, leading = 10.3, rowPadding = 7 } = {}) {
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    this.rect(x, top, totalWidth, 24, colors.deep);
    let columnX = x;
    headers.forEach((header, index) => {
      this.text(columnX + 7, top + 7, header, 8, 'bold', colors.paper);
      columnX += widths[index];
    });

    let y = top + 24;
    rows.forEach((row, rowIndex) => {
      const wrapped = row.map((cell, index) => wrapText(String(cell), widths[index] - 14, fontSize));
      const lineCount = Math.max(...wrapped.map((lines) => lines.length));
      const rowHeight = lineCount * leading + rowPadding * 2;
      this.rect(x, y, totalWidth, rowHeight, rowIndex % 2 === 0 ? colors.paper : 'F0F3F0');
      this.line(x, y + rowHeight, x + totalWidth, y + rowHeight, colors.line, 0.45);
      columnX = x;
      wrapped.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => {
          this.text(
            columnX + 7,
            y + rowPadding + lineIndex * leading,
            line,
            fontSize,
            index === 0 ? 'bold' : 'regular',
            index === 0 ? colors.green : colors.ink,
          );
        });
        columnX += widths[index];
      });
      y += rowHeight;
    });
    return y;
  }

  title(title, subtitle) {
    this.text(margin, 60, title, 23, 'bold', colors.ink);
    return this.paragraph(margin, 93, contentWidth, subtitle, {
      size: 9.6,
      leading: 13,
      color: colors.muted,
    }) + 13;
  }

  section(x, top, label, color = colors.teal) {
    this.text(x, top, label.toUpperCase(), 8, 'bold', color);
    return top + 17;
  }
}

function addPage(page) {
  const stream = `${page.commands.join('\n')}\n`;
  if (/[^\x00-\x7F]/.test(stream)) throw new Error('PDF page contains non-ASCII text');
  return stream;
}

function makeCover(updatedDate) {
  const page = new Page({ cover: true });
  page.rect(margin, 48, 34, 34, colors.teal);
  page.text(margin + 10, 52, 't', 25, 'bold', colors.paper);
  page.text(margin + 47, 55, 'TASK_KEEPER', 10, 'bold', 'D5E4DC');
  page.text(margin, 116, 'Architecture', 39, 'bold', colors.paper);
  page.text(margin, 160, '& dependencies', 39, 'bold', colors.paper);
  page.paragraph(margin, 218, 430,
    'A current system guide to the recurring-task app: how the browser, API, MongoDB, Redis, scheduler, and notification channels fit together.',
    { size: 12, leading: 18, color: 'D5E4DC' });
  page.text(margin, 284, `SYSTEM GUIDE  /  UPDATED ${updatedDate}`, 8.5, 'bold', '9BB6A8');

  page.text(margin, 347, 'THE APPLICATION AT A GLANCE', 8, 'bold', '9BB6A8');
  const nodes = [
    { x: 42, title: 'Browser', detail: 'React 19 + Vite', color: colors.teal },
    { x: 232, title: 'API + scheduler', detail: 'Express 5 / Node.js', color: colors.blue },
    { x: 422, title: 'Persistence', detail: 'MongoDB replica set', color: colors.violet },
  ];
  for (const node of nodes) {
    page.card(node.x, 374, 148, 79, { fill: '24483D', stroke: '45685B' });
    page.rect(node.x, 374, 4, 79, node.color);
    page.text(node.x + 14, 391, node.title, 11, 'bold', colors.paper);
    page.text(node.x + 14, 414, node.detail, 8.5, 'regular', 'C5D6CD');
  }
  page.arrow(193, 413, 225, '83B9A8');
  page.arrow(383, 413, 415, '83B9A8');

  page.card(42, 478, 243, 70, { fill: '24483D', stroke: '45685B' });
  page.text(56, 493, 'OPTIONAL REDIS', 8, 'bold', '9BCBC0');
  page.paragraph(56, 511, 211, 'Shared auth limits and short-lived per-user read cache.', {
    size: 8.5, leading: 12, color: 'D5E4DC',
  });
  page.card(303, 478, 267, 70, { fill: '24483D', stroke: '45685B' });
  page.text(317, 493, 'BACKGROUND WORK', 8, 'bold', 'AFC2E4');
  page.paragraph(317, 511, 238, 'A leased 15-second scheduler creates occurrences and delivers reminders.', {
    size: 8.5, leading: 12, color: 'D5E4DC',
  });
  page.line(margin, 710, pageWidth - margin, 710, '45685B', 0.7);
  page.text(margin, 726, 'PERSONAL RECURRING TASKS  /  DESIGN, DATA, API, OPERATIONS', 7.5, 'bold', '9BB6A8');
  page.text(pageWidth - margin - 67, 726, `EDITION ${updatedDate}`, 7, 'regular', '9BB6A8');
  return addPage(page);
}

function makeArchitecturePage() {
  const page = new Page({ number: 2 });
  let y = page.title('Architecture & request flow',
    'A single Node.js API serves authenticated JSON routes and owns the scheduler; the React client calls it through same-origin HTTP.');
  const gap = 14;
  const cardWidth = (contentWidth - gap) / 2;
  const sections = [
    {
      x: margin, title: 'BROWSER CLIENT', color: colors.teal,
      items: [
        'React 19 renders account, task, history, notification, and theme views.',
        'Vite serves the development client and proxies /api to Express.',
        'The API helper includes same-origin cookies and maps network/server failures to friendly messages.',
      ],
    },
    {
      x: margin + cardWidth + gap, title: 'EXPRESS API', color: colors.blue,
      items: [
        'Express 5 mounts auth, task, and notification routers under /api.',
        'JWT sessions use an HTTP-only, SameSite=Lax cookie; Secure is enabled in production.',
        'Zod validates inputs; authenticated reads and writes are scoped by user ID.',
      ],
    },
  ];
  for (const section of sections) {
    page.card(section.x, y, cardWidth, 174);
    page.text(section.x + 14, y + 14, section.title, 8, 'bold', section.color);
    let itemY = y + 37;
    for (const item of section.items) {
      itemY = page.bullet(section.x + 14, itemY, cardWidth - 28, item, { size: 8.6, leading: 11.8 }) + 8;
    }
  }

  y += 194;
  page.section(margin, y, 'Persistence and shared services');
  y += 22;
  const services = [
    { x: margin, label: 'MongoDB', body: 'Source of truth for users, tasks, occurrences, notifications, and delivery state. Transactions require a replica set.' },
    { x: margin + 180, label: 'Redis (optional)', body: 'Shared auth rate limits and a 10-second per-user response cache. Reads bypass Redis when unavailable.' },
    { x: margin + 360, label: 'External channels', body: 'SMTP email and VAPID Web Push are optional. In-app reminders remain available without them.' },
  ];
  for (const service of services) {
    page.card(service.x, y, 168, 112, { fill: colors.lightGreen });
    page.text(service.x + 12, y + 12, service.label, 9, 'bold', colors.green);
    page.paragraph(service.x + 12, y + 32, 144, service.body, { size: 8, leading: 10.8 });
  }

  y += 135;
  page.card(margin, y, contentWidth, 118, { fill: colors.lightBlue, stroke: 'D4DDF0' });
  page.text(margin + 15, y + 13, 'TYPICAL TASK UPDATE', 8, 'bold', colors.blue);
  const flow = [
    ['01', 'React submits JSON'],
    ['02', 'Express authenticates + validates'],
    ['03', 'MongoDB transaction updates schedule'],
    ['04', 'Redis read cache is invalidated'],
  ];
  const flowWidth = 121;
  flow.forEach(([number, label], index) => {
    const x = margin + 15 + index * 127;
    page.text(x, y + 40, number, 8, 'bold', colors.teal);
    page.paragraph(x, y + 57, flowWidth - 8, label, { size: 8.2, leading: 11 });
    if (index < flow.length - 1) page.arrow(x + 91, y + 65, x + 120, colors.blue);
  });
  page.paragraph(margin + 15, y + 91, contentWidth - 30,
    'The API process starts the scheduler after MongoDB connects. A MongoDB lease prevents multiple API instances from running the same tick.',
    { size: 8, leading: 10.5, color: colors.muted });
  return addPage(page);
}

function makeDataPage() {
  const page = new Page({ number: 3 });
  let y = page.title('Data model & task lifecycle',
    'MongoDB documents use UUID string IDs and camelCase fields. API responses map fields to the client contract; task and occurrence changes use transactions.');
  y = page.table(margin, y, [126, 400], ['COLLECTION', 'RESPONSIBILITY'], [
    ['users', 'Normalized email, bcrypt password hash, and notification preferences.'],
    ['tasks', 'Owner-scoped recurrence definition, timezone, next due instant, and archive state.'],
    ['occurrences', 'Scheduled instance with title/timezone snapshots, status, snooze, and reminder timestamps.'],
    ['notifications', 'Durable in-app reminders and schedule-adjustment notices with read state.'],
    ['notificationDeliveries', 'Per-channel email/push outbox state, retry timing, attempts, and push progress.'],
    ['pushSubscriptions', 'Browser subscription endpoint and account owner.'],
    ['schedulerLocks', 'Lease that coordinates scheduler ticks across API instances.'],
  ], { fontSize: 8.1, leading: 10, rowPadding: 6 });

  y += 18;
  page.section(margin, y, 'Occurrence lifecycle');
  y += 22;
  const states = [
    { x: margin, label: 'PENDING', detail: 'Scheduled and actionable on its due day.', fill: colors.lightGreen, accent: colors.teal },
    { x: margin + 181, label: 'MISSED', detail: 'Due reminder sent; stays open through its local due day.', fill: colors.lightAmber, accent: colors.amber },
    { x: margin + 362, label: 'COMPLETED', detail: 'Completed on or after the scheduled local due day.', fill: colors.lightBlue, accent: colors.blue },
  ];
  for (const state of states) {
    page.card(state.x, y, 166, 82, { fill: state.fill, stroke: colors.line });
    page.rect(state.x, y, 4, 82, state.accent);
    page.text(state.x + 13, y + 12, state.label, 8, 'bold', state.accent);
    page.paragraph(state.x + 13, y + 31, 139, state.detail, { size: 8, leading: 10.5 });
  }

  y += 103;
  page.section(margin, y, 'Schedule rules');
  y += 20;
  const rules = [
    'Daily, weekly, monthly, and yearly schedules use an IANA timezone; local due hour is preserved across daylight-saving changes.',
    'Monthly day 29-31 clamps to the month end when needed and emits a schedule-adjustment notification. Yearly February 29 is rejected.',
    'Missed items expire at midnight after their scheduled local due day. Snoozes add 30 minutes from the later of now or the existing deadline.',
    'History retains the occurrence timezone and title snapshot. Archiving hides a task without deleting its history.',
  ];
  for (const rule of rules) y = page.bullet(margin, y, contentWidth, rule, { size: 8.7, leading: 11.7 }) + 7;
  return addPage(page);
}

function makeApiSchedulerPage() {
  const page = new Page({ number: 4 });
  let y = page.title('API surface & scheduler',
    'All routes are under /api. Authentication uses the task_keeper_session cookie; task and notification data is scoped to the signed-in user.');
  y = page.table(margin, y, [98, 210, 218], ['AREA', 'ROUTES', 'KEY BEHAVIOR'], [
    ['Auth', 'POST /auth/register, /auth/login, /auth/logout; GET /auth/me', 'Bcrypt passwords, signed session cookie, and rate-limited sign-in.'],
    ['Tasks', 'GET/POST /tasks; PATCH/DELETE /tasks/:id', 'List, create, edit, or archive recurring tasks.'],
    ['Occurrences', 'POST /tasks/occurrences/:id/complete|snooze', 'Complete only on/after local due day; snooze for 30 minutes.'],
    ['History', 'GET/DELETE /tasks/history[/:id]', 'Offset-paginated history; clear or delete entries and linked records.'],
    ['Archive', 'GET /tasks?archived=true; POST /tasks/:id/restore; DELETE /tasks/:id/permanent', 'Restore or permanently remove archived tasks and related data.'],
    ['Notifications', 'GET/DELETE /notifications; PATCH|DELETE /notifications/:id', 'Read, delete, or clear in-app notices and delivery records.'],
    ['Settings', 'GET/PUT /settings/notifications; POST/DELETE /push-subscriptions', 'Manage preferences and account-owned browser subscriptions.'],
  ], { fontSize: 7.4, leading: 9.2, rowPadding: 5 });

  y += 17;
  page.section(margin, y, 'Background scheduler  /  every 15 seconds');
  y += 21;
  const steps = [
    ['1', 'Fill a rolling seven-day occurrence horizon for active schedules.'],
    ['2', 'Mark due occurrences missed and create the initial reminder.'],
    ['3', 'Send snooze-expiry reminders; repeat open missed reminders every 10 minutes.'],
    ['4', "Reconcile expiry at the end of each occurrence's local due day and advance the task."],
    ['5', 'Claim email/push outbox rows, deliver, and record success or retry state.'],
  ];
  steps.forEach(([number, description], index) => {
    const rowY = y + index * 45;
    page.rect(margin, rowY, 24, 24, index === 0 ? colors.green : colors.teal);
    page.text(margin + 8, rowY + 5, number, 9, 'bold', colors.paper);
    page.paragraph(margin + 38, rowY + 2, contentWidth - 42, description, { size: 8.8, leading: 11.8 });
  });
  page.card(margin, y + 239, contentWidth, 61, { fill: colors.lightAmber, stroke: 'E6D7C2' });
  page.text(margin + 13, y + 250, 'DELIVERY SAFETY', 7.7, 'bold', colors.amber);
  page.paragraph(margin + 13, y + 267, contentWidth - 26,
    'A lease prevents concurrent scheduler ticks. MongoDB uniqueness constraints guard duplicate open occurrences and linked notices; push retries skip subscriptions already recorded as delivered.',
    { size: 8.1, leading: 10.8 });
  return addPage(page);
}

const dependencyPurposes = {
  '@vitejs/plugin-react': 'React support in the Vite toolchain',
  bcryptjs: 'Password hashing and verification',
  'cookie-parser': 'Read the session cookie',
  concurrently: 'Run API and web development processes together',
  dotenv: 'Load local environment configuration',
  express: 'HTTP API and routing',
  'express-rate-limit': 'Registration and login rate limits',
  jsonwebtoken: 'Sign and verify session tokens',
  mongodb: 'MongoDB driver and connection pool',
  nodemailer: 'Optional SMTP email delivery',
  'rate-limit-redis': 'Redis-backed auth limiter store',
  react: 'Browser UI and component state',
  'react-dom': 'Mount React into the browser DOM',
  redis: 'Optional shared limits and response cache',
  vite: 'Development server and production bundler',
  'web-push': 'Optional VAPID browser push',
  zod: 'Request input validation',
};

function declaredDependencies(workspace, packageJson) {
  return Object.entries(packageJson.dependencies || {}).map(([name, version]) => [
    workspace,
    name,
    version,
    dependencyPurposes[name] || 'Application dependency',
  ]);
}

function makeDependenciesPage() {
  const page = new Page({ number: 5 });
  let y = page.title('Dependencies & toolchain',
    'The project is JavaScript-only and uses npm workspaces. This table is generated from the current package manifests; versions are declared semver ranges, not lockfile resolutions.');
  const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const clientPackage = JSON.parse(readFileSync(resolve(root, 'client/package.json'), 'utf8'));
  const serverPackage = JSON.parse(readFileSync(resolve(root, 'server/package.json'), 'utf8'));
  const rows = [
    ...declaredDependencies('client', clientPackage),
    ...declaredDependencies('server', serverPackage),
    ...Object.entries(rootPackage.devDependencies || {}).map(([name, version]) => [
      'root dev',
      name,
      version,
      dependencyPurposes[name] || 'Development tooling',
    ]),
  ].sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  y = page.table(margin, y, [65, 143, 82, 236], ['WORKSPACE', 'PACKAGE', 'DECLARED RANGE', 'ROLE'], rows, {
    fontSize: 7.5,
    leading: 9.2,
    rowPadding: 4.5,
  });
  y += 20;
  page.section(margin, y, 'Platform and requirements');
  y += 20;
  const requirements = [
    ['Runtime', 'Node.js 20.19+ and npm. MongoDB driver 7 requires Node.js 20.19 or newer.'],
    ['Database', 'MongoDB Atlas or another replica set; multi-document transactions are required.'],
    ['Browser APIs', 'Intl.DateTimeFormat, service workers, notifications, and Push API for relevant features.'],
    ['Optional services', 'Redis for shared rate limits/cache; SMTP and VAPID credentials for external delivery.'],
  ];
  for (const [label, detail] of requirements) {
    page.text(margin, y, label, 8.5, 'bold', colors.green);
    y = page.paragraph(margin + 98, y, contentWidth - 98, detail, { size: 8.4, leading: 11 }) + 9;
  }
  page.card(margin, 700, contentWidth, 39, { fill: colors.lightGreen });
  page.text(margin + 12, 711, 'Source of truth', 8, 'bold', colors.green);
  page.text(margin + 95, 711, 'package.json declares ranges; package-lock.json pins exact installations.', 8, 'regular', colors.ink);
  return addPage(page);
}

function makeOperationsPage(updatedDate) {
  const page = new Page({ number: 6 });
  let y = page.title('Configuration, security & operations',
    'Use a replica-set MongoDB for transactions. Redis is optional. Keep secrets in the private environment and use loopback binding for local-only development.');
  y = page.table(margin, y, [145, 130, 251], ['SETTING', 'DEFAULT', 'PURPOSE'], [
    ['MONGODB_URI', 'required', 'MongoDB connection string; keep credentials private.'],
    ['JWT_SECRET', 'required (32+ chars)', 'Signing key for session cookies.'],
    ['MONGODB_DATABASE', 'URI name / task_keeper', 'Database selected by the API.'],
    ['DB_POOL_MAX', '10', 'MongoDB maximum connection-pool size.'],
    ['PORT', '3001', 'API listen port.'],
    ['HOST', 'all interfaces', 'Optional bind address for API and Vite. Use 127.0.0.1 for loopback only.'],
    ['REDIS_URL', 'redis://localhost:6379', 'Optional shared auth limits and short-lived response cache.'],
    ['ENV_FILE', 'project .env', 'Optional path to the private server environment file.'],
  ], { fontSize: 7.9, leading: 9.8, rowPadding: 5 });

  y += 17;
  page.section(margin, y, 'Run locally');
  y += 21;
  page.card(margin, y, 254, 79, { fill: colors.deep, stroke: colors.deep });
  page.text(margin + 13, y + 11, 'WSL / POSIX', 7.5, 'bold', 'A8C9B9');
  page.text(margin + 13, y + 31, 'docker compose -f compose.redis.yml up -d', 7.1, 'regular', colors.paper);
  page.text(margin + 13, y + 48, 'HOST=127.0.0.1 npm run dev', 8, 'bold', colors.paper);
  page.card(margin + 274, y, 254, 79, { fill: colors.deep, stroke: colors.deep });
  page.text(margin + 287, y + 11, 'WINDOWS POWERSHELL', 7.5, 'bold', 'A8C9B9');
  page.text(margin + 287, y + 31, "$env:HOST = '127.0.0.1'", 8, 'regular', colors.paper);
  page.text(margin + 287, y + 48, 'npm.cmd run dev', 8, 'bold', colors.paper);

  y += 98;
  page.section(margin, y, 'Security boundaries');
  y += 20;
  const security = [
    'HTTP-only, SameSite=Lax session cookie; Secure in production. Registration and login are rate limited.',
    'Zod input validation and user-ID-scoped database operations protect application routes.',
    'Push subscription endpoints are restricted to supported secure providers and owned by one account.',
    'Development servers bind all interfaces by default. HOST=127.0.0.1 keeps both on loopback; develop only on trusted networks otherwise.',
  ];
  for (const item of security) y = page.bullet(margin, y, contentWidth, item, { size: 8.1, leading: 10.7 }) + 6;

  page.line(margin, 711, pageWidth - margin, 711, colors.line, 0.7);
  page.text(margin, 722, 'BUILD  npm run build     TEST  npm test     DOCS  npm run docs:pdf', 8, 'bold', colors.green);
  page.text(pageWidth - margin - 80, 741, `UPDATED ${updatedDate}`, 7, 'regular', colors.muted);
  return addPage(page);
}

function createPdf(streams) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  const pageIds = [];

  for (const stream of streams) {
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    objects.push('');
    const streamId = objects.length + 1;
    const streamBytes = Buffer.from(stream, 'ascii');
    objects.push(`<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`);
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`;
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const chunks = [
    Buffer.concat([
      Buffer.from('%PDF-1.4\n%', 'ascii'),
      Buffer.from([0xE2, 0xE3, 0xCF, 0xD3]),
      Buffer.from('\n', 'ascii'),
    ]),
  ];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const objectOffset of offsets.slice(1)) {
    xref += `${String(objectOffset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

const streams = [
  makeCover(updatedDate),
  makeArchitecturePage(),
  makeDataPage(),
  makeApiSchedulerPage(),
  makeDependenciesPage(),
  makeOperationsPage(updatedDate),
];
writeFileSync(outputPath, createPdf(streams));
console.log(`Generated ${outputPath} (${streams.length} pages)`);
