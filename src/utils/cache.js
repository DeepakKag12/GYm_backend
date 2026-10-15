/**
 * Hybrid Caching Engine:
 *  - Tier 1 (L1): In-process LRU cache (0ms latency, eliminates network roundtrips for super-hot keys)
 *  - Tier 2 (L2): Distributed Redis cache (sub-millisecond latency, shared across all servers/instances, survives restarts)
 *  - Request Coalescing (Single-Flight): 100 concurrent requests for cold data run only 1 DB query
 *  - Graceful Degradation: If Redis is offline or unconfigured, seamlessly runs on L1 + MongoDB
 *  - Non-blocking SCAN: Never freezes the Redis event loop during pattern invalidation
 */

const {
  isRedisReady,
  safeGet,
  safeSet,
  safeDel,
  safeDelPattern,
  getRedisStatus,
} = require('../config/redis');

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);

/** L1 in-memory map: key -> { promise, value, expiresAt, staleUntil, settled } */
const store = new Map();

const stats = {
  l1Hits: 0,
  redisHits: 0,
  misses: 0,
  stale: 0,
  coalesced: 0,
  evictions: 0,
  errors: 0,
};

/** Map preserves insertion order, so the first key is the least recently used. */
function touch(key, entry) {
  store.delete(key);
  store.set(key, entry);
}

function evictIfNeeded() {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
    stats.evictions++;
  }
}

/**
 * Synchronous L1 lookup.
 * Returns undefined if missing, expired, or still in flight.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  if (!entry.settled) return undefined;
  touch(key, entry);
  return entry.value;
}

/**
 * Asynchronous L1 + L2 Redis lookup.
 */
async function getAsync(key) {
  const local = get(key);
  if (local !== undefined) {
    stats.l1Hits++;
    return local;
  }

  if (isRedisReady()) {
    const redisRaw = await safeGet(key);
    if (redisRaw !== null) {
      try {
        const parsed = JSON.parse(redisRaw);
        stats.redisHits++;
        touch(key, {
          value: parsed,
          promise: null,
          settled: true,
          expiresAt: Date.now() + 30000,
          staleUntil: Date.now() + 30000,
        });
        evictIfNeeded();
        return parsed;
      } catch (_) {}
    }
  }

  return undefined;
}

/**
 * Set a value with a TTL in seconds in both L1 and Redis.
 */
function set(key, value, ttlSeconds = 60) {
  const ttl = Number(ttlSeconds) || 60;
  const now = Date.now();
  touch(key, {
    value,
    promise: null,
    settled: true,
    expiresAt: now + ttl * 1000,
    staleUntil: now + ttl * 1000,
  });
  evictIfNeeded();

  // Asynchronously persist to Redis
  safeSet(key, value, ttl).catch(() => {});
}

/**
 * Delete key from both L1 and Redis.
 */
function del(key) {
  store.delete(key);
  safeDel(key).catch(() => {});
}

/**
 * Delete every key containing the given substring (used after mutations).
 * Uses non-blocking SCAN on Redis to ensure zero latency spikes.
 */
function delPattern(pattern) {
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.includes(pattern)) {
      store.delete(key);
      n++;
    }
  }
  safeDelPattern(pattern).catch(() => {});
  return n;
}

/**
 * Get-or-set with request coalescing, L1 memory, and L2 Redis.
 *
 * @param {string}   key
 * @param {number}   ttlSeconds  How long the value stays fresh
 * @param {Function} fetchFn     Async producer, called at most once per miss
 * @param {object}   [opts]
 * @param {number}   [opts.swr]  Extra seconds for stale-while-revalidate
 */
async function getOrSet(key, ttlSeconds, fetchFn, opts = {}) {
  const ttl = Number(ttlSeconds) || 60;
  const swr = opts.swr || 0;
  const now = Date.now();
  const entry = store.get(key);

  if (entry) {
    // Another request is actively fetching this key — await their in-flight Promise
    if (!entry.settled) {
      stats.coalesced++;
      return entry.promise;
    }
    // L1 hit
    if (now <= entry.expiresAt) {
      stats.l1Hits++;
      touch(key, entry);
      return entry.value;
    }
    // L1 stale-while-revalidate
    if (now <= entry.staleUntil) {
      stats.stale++;
      touch(key, entry);
      refresh(key, ttl, fetchFn, swr).catch(() => {});
      return entry.value;
    }
    store.delete(key);
  }

  // Check L2 Redis before executing database query
  if (isRedisReady()) {
    const redisVal = await safeGet(key);
    if (redisVal !== null) {
      try {
        const parsed = JSON.parse(redisVal);
        stats.redisHits++;
        // Warm L1 memory for subsequent rapid lookups
        touch(key, {
          value: parsed,
          promise: null,
          settled: true,
          expiresAt: now + ttl * 1000,
          staleUntil: now + (ttl + swr) * 1000,
        });
        evictIfNeeded();
        return parsed;
      } catch (_) {}
    }
  }

  stats.misses++;
  return refresh(key, ttl, fetchFn, swr);
}

function refresh(key, ttlSeconds, fetchFn, swr) {
  let settle, fail;
  const promise = new Promise((res, rej) => {
    settle = res;
    fail = rej;
  });

  // Publish in-flight promise BEFORE executing fetchFn to coalesce all concurrent callers
  touch(key, {
    value: undefined,
    promise,
    settled: false,
    expiresAt: Date.now() + 30000,
    staleUntil: 0,
  });
  evictIfNeeded();

  Promise.resolve()
    .then(fetchFn)
    .then(value => {
      const now = Date.now();
      touch(key, {
        value,
        promise: null,
        settled: true,
        expiresAt: now + ttlSeconds * 1000,
        staleUntil: now + (ttlSeconds + swr) * 1000,
      });
      evictIfNeeded();

      // Persist to Redis asynchronously
      safeSet(key, value, ttlSeconds).catch(() => {});

      settle(value);
    })
    .catch(err => {
      // Never cache failures — allow immediate retry
      stats.errors++;
      store.delete(key);
      fail(err);
    });

  return promise;
}

function size() {
  return store.size;
}

/**
 * Hit rate and counters, exposed on GET /api/_cache/stats.
 */
function getStats() {
  const totalHits = stats.l1Hits + stats.redisHits;
  const lookups = totalHits + stats.misses + stats.stale + stats.coalesced;
  return {
    ...stats,
    hits: totalHits,
    entries: store.size,
    maxEntries: MAX_ENTRIES,
    redisStatus: getRedisStatus(),
    lookups,
    hitRate: lookups
      ? `${(((totalHits + stats.stale + stats.coalesced) / lookups) * 100).toFixed(1)}%`
      : 'n/a',
  };
}

function clear() {
  store.clear();
}

module.exports = {
  get,
  getAsync,
  set,
  del,
  delPattern,
  getOrSet,
  size,
  getStats,
  clear,
};
