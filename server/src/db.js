import { MongoClient } from 'mongodb';

let client;
let database;

export async function connectToDatabase() {
  if (database) return database;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing required environment variable: MONGODB_URI');
  client = new MongoClient(uri, {
    maxPoolSize: Number(process.env.DB_POOL_MAX || 10),
  });
  await client.connect();
  const databaseName = process.env.MONGODB_DATABASE
    || new URL(uri).pathname.slice(1)
    || 'task_keeper';
  database = client.db(decodeURIComponent(databaseName));

  await Promise.all([
    database.collection('users').createIndex({ email: 1 }, { unique: true }),
    database.collection('tasks').createIndex({ userId: 1, archived: 1, nextDueAt: 1 }),
    database.collection('occurrences').createIndex(
      { taskId: 1, dueAt: 1 },
      { unique: true },
    ),
    database.collection('occurrences').createIndex({ taskId: 1, status: 1, dueAt: 1 }),
    database.collection('occurrences').createIndex({ userId: 1, dueAt: -1, _id: -1 }),
    database.collection('occurrences').createIndex({ status: 1, dueAt: 1, initialNotifiedAt: 1 }),
    database.collection('occurrences').createIndex({ status: 1, snoozedUntil: 1 }),
    database.collection('notifications').createIndex({ userId: 1, createdAt: -1 }),
    database.collection('notifications').createIndex(
      { occurrenceId: 1, kind: 1 },
      {
        unique: true,
        partialFilterExpression: { occurrenceId: { $type: 'string' } },
      },
    ),
    database.collection('pushSubscriptions').createIndex({ endpoint: 1 }, { unique: true }),
    database.collection('pushSubscriptions').createIndex({ userId: 1 }),
    database.collection('notificationDeliveries').createIndex(
      { notificationId: 1, channel: 1 },
      { unique: true },
    ),
    database.collection('notificationDeliveries').createIndex({
      status: 1,
      retryAfter: 1,
      updatedAt: 1,
    }),
  ]);

  return database;
}

export function getDatabase() {
  if (!database) throw new Error('MongoDB is not connected');
  return database;
}

export function getMongoClient() {
  if (!client) throw new Error('MongoDB is not connected');
  return client;
}

export async function withMongoTransaction(callback) {
  const session = getMongoClient().startSession();
  try {
    return await session.withTransaction(() => callback(session));
  } finally {
    await session.endSession();
  }
}

export async function closeDatabase() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}
