import { MongoClient } from 'mongodb';

let client;
let database;
let connectionPromise;

export async function connectToDatabase() {
  if (database) return database;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Missing required environment variable: MONGODB_URI');
    const connectingClient = new MongoClient(uri, {
      maxPoolSize: Number(process.env.DB_POOL_MAX || 10),
    });

    try {
      await connectingClient.connect();
      const databaseName = process.env.MONGODB_DATABASE
        || new URL(uri).pathname.slice(1)
        || 'task_keeper';
      const connectingDatabase = connectingClient.db(decodeURIComponent(databaseName));

      await Promise.all([
        connectingDatabase.collection('users').createIndex({ email: 1 }, { unique: true }),
        connectingDatabase.collection('tasks').createIndex({ userId: 1, archived: 1, nextDueAt: 1 }),
        connectingDatabase.collection('occurrences').createIndex(
          { taskId: 1, dueAt: 1 },
          { unique: true },
        ),
        connectingDatabase.collection('occurrences').createIndex({ taskId: 1, status: 1, dueAt: 1 }),
        connectingDatabase.collection('occurrences').createIndex({ userId: 1, dueAt: -1, _id: -1 }),
        connectingDatabase.collection('occurrences').createIndex({ status: 1, dueAt: 1, initialNotifiedAt: 1 }),
        connectingDatabase.collection('occurrences').createIndex({ status: 1, snoozedUntil: 1 }),
        connectingDatabase.collection('occurrences').createIndex({ status: 1, lastReminderAt: 1 }),
        connectingDatabase.collection('notifications').createIndex({ userId: 1, createdAt: -1 }),
        connectingDatabase.collection('notifications').createIndex(
          { occurrenceId: 1, kind: 1 },
          {
            unique: true,
            partialFilterExpression: { occurrenceId: { $type: 'string' } },
          },
        ),
        connectingDatabase.collection('pushSubscriptions').createIndex({ endpoint: 1 }, { unique: true }),
        connectingDatabase.collection('pushSubscriptions').createIndex({ userId: 1 }),
        connectingDatabase.collection('notificationDeliveries').createIndex(
          { notificationId: 1, channel: 1 },
          { unique: true },
        ),
        connectingDatabase.collection('notificationDeliveries').createIndex({
          status: 1,
          retryAfter: 1,
          updatedAt: 1,
        }),
      ]);

      client = connectingClient;
      database = connectingDatabase;
      return database;
    } catch (error) {
      try {
        await connectingClient.close();
      } catch (closeError) {
        console.error('Failed to close MongoDB client after connection failure', closeError);
      }
      throw error;
    }
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = undefined;
  }
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
