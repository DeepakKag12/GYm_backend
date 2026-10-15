const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../../src/utils/cache');

describe('Unit Test: Hybrid Cache (L1 LRU, TTL, Invalidation & Single-Flight)', () => {
  test('1. Cache set & synchronous get returns value within TTL', () => {
    const key = `unit:cache:basic:${Date.now()}`;
    cache.set(key, { foo: 'bar' }, 10);
    const value = cache.get(key);
    assert.deepEqual(value, { foo: 'bar' });
    cache.del(key);
  });

  test('2. Cache key expires after TTL seconds', async () => {
    const key = `unit:cache:ttl:${Date.now()}`;
    // Set TTL = 1 second
    cache.set(key, 'quick_expire', 1);
    assert.equal(cache.get(key), 'quick_expire');

    // Wait 1.1s for expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Must be expired
    assert.equal(cache.get(key), undefined);
  });

  test('3. Single-flight request coalescing handles parallel calls and errors gracefully', async () => {
    let callCount = 0;
    const key = `unit:cache:coalesce:${Date.now()}`;

    // 10 concurrent requests
    const tasks = Array.from({ length: 10 }, () =>
      cache.getOrSet(key, 5, async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 40));
        return { data: 42 };
      })
    );

    const results = await Promise.all(tasks);
    assert.equal(callCount, 1, 'Factory producer must execute exactly once');
    for (const r of results) {
      assert.equal(r.data, 42);
    }

    cache.del(key);
  });

  test('4. Producer rejection does not poison cache indefinitely', async () => {
    const key = `unit:cache:err:${Date.now()}`;

    // Failing producer
    await assert.rejects(
      cache.getOrSet(key, 5, async () => {
        throw new Error('Database connection dropped');
      }),
      /Database connection dropped/
    );

    // After failure, next call should attempt again, not return rejected promise
    let recovered = false;
    const res = await cache.getOrSet(key, 5, async () => {
      recovered = true;
      return 'recovered_value';
    });
    assert.equal(recovered, true);
    assert.equal(res, 'recovered_value');

    cache.del(key);
  });

  test('5. delPattern invalidates keys matching prefix without affecting other keys', () => {
    const p1 = `store:prod:item1_${Date.now()}`;
    const p2 = `store:prod:item2_${Date.now()}`;
    const o1 = `orders:user:u1_${Date.now()}`;

    cache.set(p1, 'product 1', 60);
    cache.set(p2, 'product 2', 60);
    cache.set(o1, 'order 1', 60);

    assert.equal(cache.get(p1), 'product 1');
    assert.equal(cache.get(p2), 'product 2');
    assert.equal(cache.get(o1), 'order 1');

    // Invalidate store:* only
    cache.delPattern('store:');

    assert.equal(cache.get(p1), undefined);
    assert.equal(cache.get(p2), undefined);
    assert.equal(cache.get(o1), 'order 1', 'Unrelated order cache must remain intact');

    cache.del(o1);
  });

  test('6. getStats reports diagnostic counters accurately', () => {
    const stats = cache.getStats();
    assert.equal(typeof stats.hits, 'number');
    assert.equal(typeof stats.misses, 'number');
    assert.equal(typeof stats.coalesced, 'number');
    assert.equal(typeof stats.entries, 'number');
    assert.equal(typeof stats.redisStatus, 'string');
    assert.equal(typeof cache.size(), 'number');
  });
});
