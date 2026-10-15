const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { publicCache } = require('../../src/middlewares/publicCache.middleware');
const { errorHandler, notFound } = require('../../src/middlewares/error.middleware');
const { getConversationId } = require('../../src/models/Message.model');
const { isUserOnline, getOnlineUserIds, emitToUser, emitToRole, broadcastEvent } = require('../../src/socket');

describe('Unit Test: Middlewares & Socket Helpers (publicCache, errorHandler, socket)', () => {
  // 1. publicCache middleware
  test('1. publicCache sets private cache headers when unauthenticated and no-store when authenticated', () => {
    const middleware = publicCache(60);

    // Unauthenticated request
    const mockHeadersUnauth = {};
    const mockReqUnauth = { headers: {} };
    const mockResUnauth = {
      varyList: [],
      vary(h) { this.varyList.push(h); },
      set(k, v) { mockHeadersUnauth[k] = v; },
      json(data) { return data; },
      statusCode: 200,
    };

    let nextCalled = false;
    middleware(mockReqUnauth, mockResUnauth, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.ok(mockResUnauth.varyList.includes('Origin'));
    assert.ok(mockResUnauth.varyList.includes('Authorization'));
    assert.equal(mockHeadersUnauth['Cache-Control'], 'private, max-age=60, stale-while-revalidate=300');

    // Authenticated request
    const mockHeadersAuth = {};
    const mockReqAuth = { headers: { authorization: 'Bearer test-token' } };
    const mockResAuth = {
      varyList: [],
      vary(h) { this.varyList.push(h); },
      set(k, v) { mockHeadersAuth[k] = v; },
      json(data) { return data; },
      statusCode: 200,
    };

    middleware(mockReqAuth, mockResAuth, () => {});
    assert.equal(mockHeadersAuth['Cache-Control'], 'no-store');
  });

  test('2. publicCache enforces no-store on error responses (>= 400)', () => {
    const middleware = publicCache(60);
    const mockHeaders = {};
    const mockReq = { headers: {} };
    const mockRes = {
      vary() {},
      set(k, v) { mockHeaders[k] = v; },
      statusCode: 404,
      json(data) { return data; },
    };

    middleware(mockReq, mockRes, () => {});
    // Trigger json serialization on error response
    mockRes.json({ message: 'Not found' });
    assert.equal(mockHeaders['Cache-Control'], 'no-store');
  });

  // 2. Error handling middleware
  test('3. errorHandler formats clean JSON with status and message; notFound returns 404', () => {
    const mockReq = { originalUrl: '/api/nonexistent-route' };
    let statusSet = 0;
    let jsonBody = null;
    const mockRes = {
      status(code) { statusSet = code; return this; },
      json(body) { jsonBody = body; return this; },
    };

    // notFound middleware
    notFound(mockReq, mockRes, () => {});
    assert.equal(statusSet, 404);
    assert.equal(jsonBody.message, 'Route not found: /api/nonexistent-route');

    // errorHandler middleware
    const customErr = new Error('Custom validation error');
    customErr.statusCode = 422;
    errorHandler(customErr, mockReq, mockRes, () => {});
    assert.equal(statusSet, 422);
    assert.equal(jsonBody.message, 'Custom validation error');
  });

  // 3. Socket Helpers
  test('4. Socket helpers return deterministic identifiers and handle offline states safely', () => {
    const id1 = getConversationId('userA', 'userB');
    const id2 = getConversationId('userB', 'userA');
    assert.equal(id1, id2, 'Conversation ID must be symmetric and deterministic');

    assert.equal(isUserOnline('offline-user-123'), false);
    assert.deepEqual(getOnlineUserIds(), []);
    assert.equal(emitToUser('offline-user-123', 'msg', {}), false);
    assert.equal(emitToRole('admin', 'msg', {}), false);
    assert.equal(broadcastEvent('msg', {}), false);
  });
});
