/**
 * In-process TTL cache.
 *
 * Three problems with the previous version, all of which show up under real
 * traffic rather than in testing:
 *
 *  1. No request coalescing. getOrSet() awaited the fetch before storing
 *     anything, so N simultaneous requests for a cold key ran N identical
 *     Mongo queries. That is exactly what happens when a Vercel instance goes
 *     cold and several dashboard widgets load at once.
 *  2. No size limit. Keys like `member:profile:<id>` are unbounded, so the map
 *     grew for the life of the process.
 *  3. No visibility — no way to tell a working cache from a useless one.
 *
 * It now stores the in-flight PROMISE (so concurrent callers share one query),
 * evicts least-recently-used entries above a cap, and counts what it is doing.
 *
 * Scope note: this lives in one process. On Vercel each instance keeps its own
 * copy, so TTLs are deliberately short and every mutation still calls del() /
 * delPattern() rather than relying on the cache expiring.
 */

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);

/** key -> { promise, value, expiresAt, staleUntil, settled } */
const store = new Map();

const stats = { hits: 0, misses: 0, stale: 0, coalesced: 0, evictions: 0, errors: 0 };

/** Map keeps insertion order, so the first key is the least recently used. */
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

/** Get a settled value. Returns undefined if missing, expired or still in flight. */
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

/** Set a value with a TTL in seconds. */
function set(key, value, ttlSeconds) {
  const now = Date.now();
  touch(key, {
    value,
    promise: null,
    settled: true,
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + ttlSeconds * 1000,
  });
  evictIfNeeded();
}

function del(key) {
  store.delete(key);
}

/** Delete every key containing the given substring (used after a mutation). */
function delPattern(pattern) {
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.includes(pattern)) { store.delete(key); n++; }
  }
  return n;
}

/**
 * Get-or-set with request coalescing.
 *
 * @param {string}   key
 * @param {number}   ttlSeconds  How long the value stays fresh
 * @param {Function} fetchFn     Async producer, called at most once per miss
 * @param {object}   [opts]
 * @param {number}   [opts.swr]  Extra seconds during which an expired value is
 *                               still served while it refreshes in the
 *                               background. Turns a slow miss into a fast hit
 *                               for everyone except the one request that
 *                               triggers the refresh.
 */
async function getOrSet(key, ttlSeconds, fetchFn, opts = {}) {
  const swr = opts.swr || 0;
  const now = Date.now();
  const entry = store.get(key);

  if (entry) {
    // Someone else is already fetching this exact key — wait on their query.
    if (!entry.settled) {
      stats.coalesced++;
      return entry.promise;
    }
    if (now <= entry.expiresAt) {
      stats.hits++;
      touch(key, entry);
      return entry.value;
    }
    if (now <= entry.staleUntil) {
      // Serve the stale copy now, refresh behind the request.
      stats.stale++;
      touch(key, entry);
      refresh(key, ttlSeconds, fetchFn, swr).catch(() => {});
      return entry.value;
    }
    store.delete(key);
  }

  stats.misses++;
  return refresh(key, ttlSeconds, fetchFn, swr);
}

function refresh(key, ttlSeconds, fetchFn, swr) {
  let settle, fail;
  const promise = new Promise((res, rej) => { settle = res; fail = rej; });

  // Publish the in-flight promise BEFORE starting the work, so a concurrent
  // caller always finds it — and so a fetchFn that throws synchronously cannot
  // leave a rejected promise parked in the map.
  touch(key, { value: undefined, promise, settled: false, expiresAt: Date.now() + 30000, staleUntil: 0 });
  evictIfNeeded();

  Promise.resolve()
    .then(fetchFn)                 // converts a synchronous throw into a rejection
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
      settle(value);
    })
    .catch(err => {
      // Never cache a failure — the next caller must be free to retry.
      stats.errors++;
      store.delete(key);
      fail(err);
    });

  return promise;
}

function size() {
  return store.size;
}

/** Hit rate and counters, exposed on GET /api/_cache/stats. */
function getStats() {
  const lookups = stats.hits + stats.misses + stats.stale + stats.coalesced;
  return {
    ...stats,
    entries: store.size,
    maxEntries: MAX_ENTRIES,
    lookups,
    hitRate: lookups ? `${(((stats.hits + stats.stale + stats.coalesced) / lookups) * 100).toFixed(1)}%` : 'n/a',
  };
}

function clear() {
  store.clear();
}

module.exports = { get, set, del, delPattern, getOrSet, size, getStats, clear };
