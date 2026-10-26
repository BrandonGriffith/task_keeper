import './config.js';
import { createServer } from 'node:http';
import app from './app.js';
import { assertRuntimeConfig } from './config.js';
import { closeDatabase, connectToDatabase } from './db.js';
import { startScheduler, stopScheduler } from './scheduler.js';

assertRuntimeConfig();
await connectToDatabase();
const port = Number(process.env.PORT || 3001);
const server = createServer(app);

server.listen(port, () => {
  console.log(`task_keeper API listening on http://localhost:${port}`);
  startScheduler();
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  stopScheduler();
  server.close(async (error) => {
    if (error) {
      console.error('Failed to close HTTP server cleanly', error);
      process.exitCode = 1;
    }
    await closeDatabase();
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
