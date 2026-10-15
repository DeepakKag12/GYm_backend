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
const Payment = require('../src/models/Payment.model');
const Order = require('../src/models/Order.model');

const bcrypt = require('bcryptjs');
const { monthStart } = require('../src/controllers/analytics.controller');

describe('Analytics Routes & Controller (/api/analytics)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser, memberToken;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^analyticstest_/ });

    const hashedPassword = await bcrypt.hash('password123', 10);

    adminUser = await User.create({
      name: 'Analytics Admin',
      email: 'analyticstest_admin@example.com',
      phone: '9876543701',
      password: hashedPassword,
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'Analytics Trainer',
      email: 'analyticstest_trainer@example.com',
      phone: '9876543702',
      password: hashedPassword,
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser = await User.create({
      name: 'Analytics Member',
      email: 'analyticstest_member@example.com',
      phone: '9876543703',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      feeAmount: 2000,
      feePaid: true,
    });
    memberToken = makeToken(memberUser);

    await Payment.create({
      member: memberUser._id,
      source: 'membership',
      amount: 2000,
      method: 'cash',
      kind: 'new-membership',
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/analytics`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^analyticstest_/ });
    await teardownTestDb();
  });

  // 1. RBAC on summary
  test('1. Member is blocked with 403 on GET /api/analytics/summary', async () => {
    const res = await fetch(`${baseUrl}/summary`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('2. Admin can GET /api/analytics/summary (returns valid metrics)', async () => {
    const res = await fetch(`${baseUrl}/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.totalMembers >= 1);
    assert.ok(data.activeMembers >= 1);
    assert.ok(data.revenue >= 2000);
    assert.equal(typeof data.pendingFees, 'number');
  });

  // 2. GET /api/analytics/trainer-summary (trainerOrAdmin)
  test('3. Trainer can GET /api/analytics/trainer-summary, Member gets 403', async () => {
    const resTrainer = await fetch(`${baseUrl}/trainer-summary`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resTrainer.status, 200);
    const data = await resTrainer.json();
    assert.ok(data.totalMembers >= 1);
    assert.equal(typeof data.totalExercises, 'number');

    const resMember = await fetch(`${baseUrl}/trainer-summary`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resMember.status, 403);
  });

  // 3. GET /api/analytics/revenue-monthly
  test('4. Admin can GET /api/analytics/revenue-monthly', async () => {
    const res = await fetch(`${baseUrl}/revenue-monthly`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  // 4. GET /api/analytics/membership-stats
  test('5. Admin can GET /api/analytics/membership-stats', async () => {
    const res = await fetch(`${baseUrl}/membership-stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  // 5. GET /api/analytics/new-members-monthly
  test('6. Admin can GET /api/analytics/new-members-monthly', async () => {
    const res = await fetch(`${baseUrl}/new-members-monthly`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  // 6. GET /api/analytics/revenue-full
  test('7. Admin can GET /api/analytics/revenue-full (returns 12 months array)', async () => {
    const res = await fetch(`${baseUrl}/revenue-full`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.months));
    assert.equal(data.months.length, 12);
    assert.ok(data.totals);
  });

  // 7. POST /api/analytics/reset (scoped data reset)
  test('8. resetAnalytics rejects wrong password with 401, clears selected scope with valid password', async () => {
    // Wrong password
    const resWrongPw = await fetch(`${baseUrl}/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        password: 'wrongpassword',
        confirm: 'DELETE',
        scopes: ['orders'],
      }),
    });
    assert.equal(resWrongPw.status, 401);

    // Missing confirm string
    const resNoConfirm = await fetch(`${baseUrl}/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        password: 'password123',
        scopes: ['orders'],
      }),
    });
    assert.equal(resNoConfirm.status, 400);

    // Valid reset of notifications
    const resValid = await fetch(`${baseUrl}/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        password: 'password123',
        confirm: 'DELETE',
        scopes: ['notifications'],
      }),
    });
    assert.equal(resValid.status, 200);
    const data = await resValid.json();
    assert.ok(data.deleted);
  });

  // 8. POST /api/analytics/reset-to-production guards
  test('9. resetToProduction rejects missing confirmation token and invalid password', async () => {
    const resNoToken = await fetch(`${baseUrl}/reset-to-production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ confirm: 'INVALID', password: 'password123' }),
    });
    assert.equal(resNoToken.status, 400);

    const resWrongPw = await fetch(`${baseUrl}/reset-to-production`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ confirm: 'RESET_TO_PRODUCTION', password: 'wrong' }),
    });
    assert.equal(resWrongPw.status, 401);
  });

  // 9. monthStart boundary verification
  test('10. monthStart accurately calculates previous month start without 31st overflow', () => {
    // On March 31, 2025, monthStart(-1) must return Feb 1, 2025 (month 1 in 0-indexed JS)
    const march31 = new Date(2025, 2, 31, 15, 30, 0);
    const lastMonthFromMarch31 = monthStart(-1, march31);
    assert.equal(lastMonthFromMarch31.getFullYear(), 2025);
    assert.equal(lastMonthFromMarch31.getMonth(), 1); // 1 = February
    assert.equal(lastMonthFromMarch31.getDate(), 1);

    // On Jan 31, 2025, monthStart(-1) must return Dec 1, 2024
    const jan31 = new Date(2025, 0, 31, 12, 0, 0);
    const lastMonthFromJan31 = monthStart(-1, jan31);
    assert.equal(lastMonthFromJan31.getFullYear(), 2024);
    assert.equal(lastMonthFromJan31.getMonth(), 11); // 11 = December
    assert.equal(lastMonthFromJan31.getDate(), 1);
  });
});
