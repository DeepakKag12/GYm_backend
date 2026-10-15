const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('./test_helper');
const app = require('../src/app');
const User = require('../src/models/User.model');
const SiteSettings = require('../src/models/SiteSettings.model');

describe('Settings Routes & Controller (/api/settings)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let memberUser, memberToken;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^settingstest_/ });

    adminUser = await User.create({
      name: 'Settings Admin',
      email: 'settingstest_admin@example.com',
      phone: '9876543601',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'Settings Member',
      email: 'settingstest_member@example.com',
      phone: '9876543602',
      password: 'password123',
      role: 'member',
    });
    memberToken = makeToken(memberUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/settings`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^settingstest_/ });
    await teardownTestDb();
  });

  // 1. GET /api/settings
  test('1. Public can GET /api/settings without authentication', async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    const settings = await res.json();
    assert.ok(settings.gymName);
    assert.ok(settings.phone);
  });

  // 2. PUT /api/settings (validation & RBAC)
  test('2. Non-admin is blocked with 403 on PUT /api/settings', async () => {
    const res = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ gymName: 'Hacked Gym' }),
    });
    assert.equal(res.status, 403);
  });

  test('3. PUT /api/settings rejects empty gymName or phone with 400', async () => {
    const resNoName = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ gymName: '' }),
    });
    assert.equal(resNoName.status, 400);

    const resNoPhone = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ phone: '' }),
    });
    assert.equal(resNoPhone.status, 400);
  });

  test('4. Admin can update settings and cache is invalidated immediately', async () => {
    const newTagline = `Strength & Power ${Date.now()}`;
    const res = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        tagline: newTagline,
        address: 'MG Road, Indore',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.settings.tagline, newTagline);

    // Immediate GET reflects new tagline without stale cache
    const resGet = await fetch(baseUrl);
    assert.equal(resGet.status, 200);
    const fresh = await resGet.json();
    assert.equal(fresh.tagline, newTagline);
  });

  // 3. POST /api/settings/upload-image
  test('5. upload-image rejects non-admin with 403 and unauthenticated with 401', async () => {
    const resUnauth = await fetch(`${baseUrl}/upload-image`, { method: 'POST' });
    assert.equal(resUnauth.status, 401);

    const resMember = await fetch(`${baseUrl}/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resMember.status, 403);
  });

  test('6. upload-image rejects request with no file uploaded', async () => {
    const res = await fetch(`${baseUrl}/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /no image file/i);
  });
});
