const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-connectivity-audit-1234567890';
process.env.NODE_ENV = 'test';

const app = require('../src/app');
const { initSocket } = require('../src/socket');

test('End-to-End Connectivity: Express HTTP routes + WebSockets communication', async (t) => {
  let server;
  let port;

  before(async () => {
    server = http.createServer(app);
    initSocket(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('1. HTTP GET / returns 200 and API status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  await t.test('2. CORS headers are returned for frontend origins', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://gym-web-ten-puce.vercel.app',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://gym-web-ten-puce.vercel.app');
  });

  await t.test('3. Chat routes are mounted under /api/chat and guarded', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/conversations`);
    // When DB is offline during unit testing, DB guard returns 503; with live DB, auth guard returns 401.
    // In neither case should it return 404 Not Found.
    assert.notStrictEqual(res.status, 404);
    assert.ok(res.status === 401 || res.status === 503);
    const body = await res.json();
    assert.ok(body.message);
  });

  await t.test('4. Socket.IO polling endpoint responds to handshake', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`);
    // Without token, Socket middleware rejects handshake with 400 Bad Request or 200 with error packet
    assert.ok(res.status === 400 || res.status === 200);
    const text = await res.text();
    assert.ok(text.length > 0);
  });
});
