const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient, isRedisReady } = require('../config/redis');

/**
 * ResilientRateLimitStore:
 * Wraps RedisStore and express-rate-limit's built-in MemoryStore into a unified
 * composite store.
 *
 * 1. Under normal operation with Redis:
 *    - All server instances and cluster workers share unified counts in Redis.
 * 2. If Redis goes down, times out, or is unreachable:
 *    - Automatically and silently falls back to local MemoryStore tracking.
 *    - Legitimate users are NEVER blocked with 500 errors.
 *    - The application remains protected from spam and brute-force attacks.
 */
class ResilientRateLimitStore {
  constructor(options = {}) {
    this.memoryStore = new rateLimit.MemoryStore();
    this.prefix = options.prefix || 'rl:';
    this.redisStore = null;

    const client = getRedisClient();
    if (client) {
      try {
        this.redisStore = new RedisStore({
          sendCommand: (...args) => {
            const currentClient = getRedisClient();
            if (!currentClient || !isRedisReady()) {
              throw new Error('Redis client currently not ready');
            }
            return currentClient.call(...args);
          },
          prefix: this.prefix,
        });
      } catch (err) {
        this.redisStore = null;
      }
    }
  }

  init(options) {
    this.memoryStore.init(options);
    if (this.redisStore && typeof this.redisStore.init === 'function') {
      try {
        this.redisStore.init(options);
      } catch (_) {}
    }
  }

  async increment(key) {
    if (isRedisReady() && this.redisStore) {
      try {
        return await this.redisStore.increment(key);
      } catch (err) {
        // Fall back gracefully to memory store on any Redis failure
      }
    }
    return this.memoryStore.increment(key);
  }

  async decrement(key) {
    if (isRedisReady() && this.redisStore) {
      try {
        await this.redisStore.decrement(key);
      } catch (_) {}
    }
    return this.memoryStore.decrement(key);
  }

  async resetKey(key) {
    if (isRedisReady() && this.redisStore) {
      try {
        await this.redisStore.resetKey(key);
      } catch (_) {}
    }
    return this.memoryStore.resetKey(key);
  }

  async resetAll() {
    if (isRedisReady() && this.redisStore && typeof this.redisStore.resetAll === 'function') {
      try {
        await this.redisStore.resetAll();
      } catch (_) {}
    }
    if (typeof this.memoryStore.resetAll === 'function') {
      await this.memoryStore.resetAll();
    }
  }
}

/**
 * Auth rate limiter: 30 requests per 15 minutes per IP
 * Protects login and register endpoints against credential stuffing and brute-force attacks.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true, // Never block requests with 500 if store has an unexpected glitch
  store: new ResilientRateLimitStore({ prefix: 'rl:auth:' }),
  message: {
    status: 429,
    message: 'Too many login attempts. Please try again after 15 minutes.',
  },
});

/**
 * General API rate limiter: 200 requests per 1 minute per IP
 * Protects all general API endpoints against DoS, scraping, and flooding.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: new ResilientRateLimitStore({ prefix: 'rl:api:' }),
});

/**
 * Public enquiry rate limiter: 10 requests per 15 minutes per IP
 * Protects lead submission against bot floods and spamming admin WhatsApp/email.
 */
const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: new ResilientRateLimitStore({ prefix: 'rl:enquiry:' }),
  message: {
    status: 429,
    message: 'Too many enquiries sent from this network. Please wait a few minutes before trying again.',
  },
});

module.exports = {
  authLimiter,
  apiLimiter,
  enquiryLimiter,
  ResilientRateLimitStore,
};
