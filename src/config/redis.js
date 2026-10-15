const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_TLS_URL || '';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false' && Boolean(REDIS_URL);

let redisClient = null;
let isConnected = false;
let lastErrorLog = 0;

if (REDIS_ENABLED) {
  try {
    const isTls = REDIS_URL.startsWith('rediss://');
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,      // Fail-fast so HTTP requests don't hang if Redis is struggling
      enableOfflineQueue: false,     // Never pile up unhandled commands in RAM during outages (prevents OOM crashes)
      connectTimeout: 5000,
      commandTimeout: 1500,          // Any Redis query taking > 1.5s is aborted and falls back to DB/RAM
      lazyConnect: false,
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
      retryStrategy(times) {
        // Exponential backoff capped at 5 seconds; never crashes the host process
        return Math.min(times * 200, 5000);
      },
    });

    redisClient.on('connect', () => {
      // Connection handshake started
    });

    redisClient.on('ready', () => {
      isConnected = true;
      console.log('⚡ [Redis] Connected and ready for caching & distributed rate-limiting.');
    });

    redisClient.on('error', (err) => {
      isConnected = false;
      const now = Date.now();
      // Throttle error warnings to once every 30 seconds to prevent console flooding under high traffic
      if (now - lastErrorLog > 30000) {
        lastErrorLog = now;
        console.warn(`⚠️ [Redis] Connection warning: ${err.message}. Gracefully falling back to in-memory mode.`);
      }
    });

    redisClient.on('close', () => {
      isConnected = false;
    });

    redisClient.on('reconnecting', () => {
      isConnected = false;
    });
  } catch (err) {
    console.warn(`⚠️ [Redis] Client initialization error: ${err.message}. Running in memory-only mode.`);
    redisClient = null;
    isConnected = false;
  }
} else {
  // Clear, non-intrusive notification when Redis is not provided
  console.log('ℹ️ [Redis] No REDIS_URL configured. Operating in robust in-memory caching and rate-limiting mode.');
}

/**
 * Returns true only when Redis is healthy and ready to accept commands
 */
function isRedisReady() {
  return Boolean(redisClient && isConnected && redisClient.status === 'ready');
}

/**
 * Return raw Redis client or null
 */
function getRedisClient() {
  return redisClient;
}

/**
 * Return current Redis status description for health endpoints
 */
function getRedisStatus() {
  if (!REDIS_ENABLED) return 'disabled (memory-only)';
  if (isRedisReady()) return 'ready';
  if (redisClient) return redisClient.status || 'connecting';
  return 'offline';
}

/**
 * Safe Redis GET - returns null on missing, failure, or timeout
 */
async function safeGet(key) {
  if (!isRedisReady()) return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    return null;
  }
}

/**
 * Safe Redis SET with optional TTL in seconds
 */
async function safeSet(key, value, ttlSeconds) {
  if (!isRedisReady()) return false;
  try {
    const stringVal = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && Number(ttlSeconds) > 0) {
      await redisClient.set(key, stringVal, 'EX', Math.floor(ttlSeconds));
    } else {
      await redisClient.set(key, stringVal);
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Safe Redis DEL
 */
async function safeDel(key) {
  if (!isRedisReady()) return 0;
  try {
    return await redisClient.del(key);
  } catch (err) {
    return 0;
  }
}

/**
 * Safe Redis pattern deletion using non-blocking SCAN.
 * NEVER blocks the Redis single thread (unlike KEYS *).
 */
async function safeDelPattern(pattern) {
  if (!isRedisReady()) return 0;
  try {
    let cursor = '0';
    let totalDeleted = 0;
    const match = pattern.includes('*') ? pattern : `*${pattern}*`;
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', match, 'COUNT', 100);
      cursor = nextCursor;
      if (keys && keys.length > 0) {
        await redisClient.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== '0');
    return totalDeleted;
  } catch (err) {
    return 0;
  }
}

/**
 * Graceful shutdown hook
 */
async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (_) {
      redisClient.disconnect();
    }
  }
}

module.exports = {
  redisClient,
  isRedisReady,
  getRedisClient,
  getRedisStatus,
  safeGet,
  safeSet,
  safeDel,
  safeDelPattern,
  closeRedis,
};
