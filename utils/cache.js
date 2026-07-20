/**
 * Lightweight in-process TTL cache.
 *
 * Usage:
 *   const cache = require('./utils/cache');
 *   const data  = await cache.getOrSet('key', ttlSeconds, () => fetchFromDB());
 *   cache.del('key');          // manual invalidation
 *   cache.delPattern('store'); // invalidate all keys containing "store"
 */

const store = new Map(); // key → { value, expiresAt }

/**
 * Get a cached value. Returns undefined if missing or expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Set a value with a TTL in seconds.
 */
function set(key, value, ttlSeconds) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Delete a specific key.
 */
function del(key) {
  store.delete(key);
}

/**
 * Delete all keys whose name contains the given substring.
 */
function delPattern(pattern) {
  for (const key of store.keys()) {
    if (key.includes(pattern)) store.delete(key);
  }
}

/**
 * Get-or-set: returns cached value if fresh, otherwise calls fetchFn(),
 * caches the result, and returns it.
 *
 * @param {string}   key         Cache key
 * @param {number}   ttlSeconds  Time to live
 * @param {Function} fetchFn     Async function that returns the value
 */
async function getOrSet(key, ttlSeconds, fetchFn) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const value = await fetchFn();
  set(key, value, ttlSeconds);
  return value;
}

/** How many entries are currently cached (for debug/health checks). */
function size() {
  return store.size;
}

module.exports = { get, set, del, delPattern, getOrSet, size };
