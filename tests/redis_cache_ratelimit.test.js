const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/utils/cache');
const { safeGet, safeSet, safeDel, safeDelPattern, isRedisReady, getRedisStatus } = require('../src/config/redis');
const { ResilientRateLimitStore } = require('../src/middlewares/rateLimiter');

test('Redis Cache & Rate-Limiter Resilience Suite', async (t) => {
  await t.test('1. Redis safe helper functions degrade gracefully when offline/unconfigured', async () => {
    // When Redis is not connected or offline, safe functions must NEVER throw
    assert.equal(isRedisReady(), false);
    assert.match(getRedisStatus(), /(disabled|offline|connecting)/);

    const val = await safeGet('any:test:key');
    assert.equal(val, null);

    const setRes = await safeSet('any:test:key', { test: true }, 60);
    assert.equal(setRes, false);

    const delRes = await safeDel('any:test:key');
    assert.equal(delRes, 0);

    const patternRes = await safeDelPattern('test:pattern:');
    assert.equal(patternRes, 0);
  });

  await t.test('2. Hybrid cache request coalescing (single-flight / anti-stampede)', async () => {
    let producerCallCount = 0;
    const key = `test:coalesce:${Date.now()}`;

    // Simulate 5 simultaneous requests for a cold key
    const promises = Array.from({ length: 5 }, () =>
      cache.getOrSet(key, 10, async () => {
        producerCallCount++;
        // Small delay to simulate DB query
        await new Promise((r) => setTimeout(r, 50));
        return { message: 'coalesced_data', time: Date.now() };
      })
    );

    const results = await Promise.all(promises);

    // Producer must only have run ONCE
    assert.equal(producerCallCount, 1, 'Database producer function should only execute once across simultaneous requests');
    // All 5 callers must have received identical data
    for (const res of results) {
      assert.equal(res.message, 'coalesced_data');
    }

    // Clean up
    cache.del(key);
  });

  await t.test('3. Cache set, get, del, and delPattern work seamlessly', async () => {
    const key1 = `test:item:1:${Date.now()}`;
    const key2 = `test:item:2:${Date.now()}`;

    cache.set(key1, { id: 1, name: 'Item 1' }, 10);
    cache.set(key2, { id: 2, name: 'Item 2' }, 10);

    assert.deepEqual(cache.get(key1), { id: 1, name: 'Item 1' });
    assert.deepEqual(cache.get(key2), { id: 2, name: 'Item 2' });

    // Pattern delete
    cache.delPattern('test:item:');
    assert.equal(cache.get(key1), undefined);
    assert.equal(cache.get(key2), undefined);
  });

  await t.test('4. Cache stats track hits, misses, coalescing, and redisStatus', async () => {
    const stats = cache.getStats();
    assert.equal(typeof stats.hits, 'number');
    assert.equal(typeof stats.misses, 'number');
    assert.equal(typeof stats.coalesced, 'number');
    assert.equal(typeof stats.redisStatus, 'string');
    assert.equal(typeof stats.hitRate, 'string');
  });

  await t.test('5. ResilientRateLimitStore falls back gracefully to in-memory tracking', async () => {
    const store = new ResilientRateLimitStore({ prefix: 'test:rl:' });
    store.init({ windowMs: 60000 });

    const key = 'test-ip-127.0.0.1';
    const hit1 = await store.increment(key);
    assert.equal(hit1.totalHits, 1);

    const hit2 = await store.increment(key);
    assert.equal(hit2.totalHits, 2);

    await store.decrement(key);
    await store.resetKey(key);

    const hitAfterReset = await store.increment(key);
    assert.equal(hitAfterReset.totalHits, 1);
  });
});
