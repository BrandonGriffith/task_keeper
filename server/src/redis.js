import { MemoryStore } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import './config.js';

let client;
let connectionPromise;
let redisErrorReported = false;
let cacheErrorReported = false;
let redisCloseRequested = false;

const responseCachePrefix = 'task_keeper:response:v1';
const responseCacheTtlSeconds = 10;

function reportCacheError(error) {
  if (redisCloseRequested || cacheErrorReported) return;
  cacheErrorReported = true;
  console.error('Redis response cache failed; bypassing cached reads', error);
}

function getClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (error) => {
      if (redisCloseRequested || redisErrorReported) return;
      redisErrorReported = true;
      console.error('Redis client error; using local authentication rate limits', error);
    });
    client.on('ready', () => {
      redisErrorReported = false;
      cacheErrorReported = false;
      console.log('Redis connected');
    });
  }
  return client;
}

export function connectToRedis() {
  if (!process.env.REDIS_URL) return Promise.resolve(false);

  let redis;
  try {
    redis = getClient();
  } catch (error) {
    console.error('Redis configuration is invalid; using local authentication rate limits', error);
    return Promise.resolve(false);
  }
  if (redis.isReady) return Promise.resolve(true);
  if (connectionPromise) return connectionPromise;

  connectionPromise = redis.connect()
    .then(() => true)
    .catch((error) => {
      if (!redisCloseRequested && !redisErrorReported) {
        console.error('Redis connection failed; using local authentication rate limits', error);
      }
      return false;
    })
    .finally(() => {
      connectionPromise = undefined;
    });

  return connectionPromise;
}

export async function closeRedis() {
  redisCloseRequested = true;
  if (client?.isOpen) await client.close();
}

class RedisRateLimitStore {
  localKeys = false;
  memoryStore = new MemoryStore();
  redisStore;
  options;

  init(options) {
    this.options = options;
    this.memoryStore.init(options);
  }

  getRedisStore() {
    if (!client?.isReady) return undefined;
    if (!this.redisStore) {
      this.redisStore = new RedisStore({
        prefix: 'task_keeper:auth:',
        sendCommand: (...args) => client.sendCommand(args),
      });
      this.redisStore.init(this.options);
    }
    return this.redisStore;
  }

  async useStore(method, key) {
    const redisStore = this.getRedisStore();
    if (!redisStore) return this.memoryStore[method](key);

    try {
      return await redisStore[method](key);
    } catch (error) {
      console.error('Redis authentication rate limit failed; using local rate limits', error);
      return this.memoryStore[method](key);
    }
  }

  get(key) {
    return this.useStore('get', key);
  }

  increment(key) {
    return this.useStore('increment', key);
  }

  decrement(key) {
    return this.useStore('decrement', key);
  }

  resetKey(key) {
    return this.useStore('resetKey', key);
  }
}

export function createAuthRateLimitStore() {
  return process.env.REDIS_URL ? new RedisRateLimitStore() : undefined;
}

export async function getCachedJsonResponse(userId, responseKey, load) {
  if (!process.env.REDIS_URL || !client?.isReady) return load();

  const redis = client;
  const userKey = encodeURIComponent(userId);
  const versionKey = `${responseCachePrefix}:version:${userKey}`;
  const cacheKey = `${responseCachePrefix}:user:${userKey}:response:${encodeURIComponent(responseKey)}`;
  let version;
  try {
    const [currentVersion, cached] = await redis
      .multi()
      .get(versionKey)
      .get(cacheKey)
      .exec();
    version = currentVersion ?? '0';
    if (cached !== null) {
      try {
        const entry = JSON.parse(cached);
        if (entry.version === version && Object.hasOwn(entry, 'response')) {
          return entry.response;
        }
      } catch (error) {
        reportCacheError(error);
      }
    }
  } catch (error) {
    reportCacheError(error);
    return load();
  }

  const response = await load();
  try {
    const serialized = JSON.stringify({ version, response });
    if (serialized !== undefined) {
      await redis.set(cacheKey, serialized, { EX: responseCacheTtlSeconds });
    }
  } catch (error) {
    reportCacheError(error);
  }
  return response;
}

export async function invalidateUserReadCache(userId) {
  if (!process.env.REDIS_URL || !client?.isReady) return;
  try {
    await client.incr(`${responseCachePrefix}:version:${encodeURIComponent(userId)}`);
  } catch (error) {
    reportCacheError(error);
  }
}
