import './config.js';
import { createServer } from 'node:http';
import app from './app.js';
import { assertRuntimeConfig } from './config.js';
import { closeDatabase, connectToDatabase } from './db.js';
import { closeRedis, connectToRedis } from './redis.js';
import { startScheduler, stopScheduler } from './scheduler.js';

assertRuntimeConfig();
const port = Number(process.env.PORT || 3001);
const server = createServer(app);
const databaseRetryDelayMs = 5_000;
let shutdownRequested = false;
let connectionAttempt;
let redisConnectionAttempt;

async function connectToDatabaseWithRetry() {
  while (!shutdownRequested) {
    connectionAttempt = connectToDatabase();
    try {
      await connectionAttempt;
      connectionAttempt = undefined;
      console.log('MongoDB connected');
      if (!shutdownRequested) startScheduler();
      return;
    } catch (error) {
      connectionAttempt = undefined;
      if (shutdownRequested) return;
      console.error(`MongoDB connection failed; retrying in ${databaseRetryDelayMs / 1000} seconds`, error);
      await new Promise((resolve) => setTimeout(resolve, databaseRetryDelayMs));
    }
  }
}

server.listen(port, () => {
  console.log(`task_keeper API listening on http://localhost:${port}`);
  redisConnectionAttempt = connectToRedis();
  void connectToDatabaseWithRetry();
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  shutdownRequested = true;
  stopScheduler();
  server.close(async (error) => {
    if (error) {
      console.error('Failed to close HTTP server cleanly', error);
      process.exitCode = 1;
    }
    if (connectionAttempt) {
      await connectionAttempt.catch(() => {});
    }
    await closeRedis();
    if (redisConnectionAttempt) await redisConnectionAttempt;
    await closeDatabase();
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
