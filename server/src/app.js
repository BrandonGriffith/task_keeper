import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import authRouter, { requireAuth } from './auth.js';
import { getDatabase } from './db.js';
import { errorHandler } from './errors.js';
import notificationsRouter from './notifications.js';
import tasksRouter from './tasks.js';

const app = express();
const clientDist = resolve(fileURLToPath(new URL('../../client/dist/', import.meta.url)));

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

app.get('/api/health', async (_request, response) => {
  await getDatabase().command({ ping: 1 });
  return response.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api', requireAuth, notificationsRouter);

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(resolve(clientDist, 'index.html'));
  });
}

app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

export default app;
