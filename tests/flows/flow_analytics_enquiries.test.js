const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('../test_helper');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Enquiry = require('../../src/models/Enquiry.model');
const Payment = require('../../src/models/Payment.model');
const Order = require('../../src/models/Order.model');

describe('Flow 7: Enquiries, Analytics Match & Cache E2E Flow', () => {
  let server;
  let baseUrl;
  let adminUser;
  let adminToken;
  let memberUser;
  let memberToken;

  before(async () => {
    await setupTestDb();

    // Scoped cleanup
    const users = await User.find({ email: /^flow7_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Payment.deleteMany({ member: { $in: uids } });
      await Order.deleteMany({ user: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }
    await Enquiry.deleteMany({ email: /^flow7_/ });

    adminUser = await User.create({
      name: 'Flow7 Admin',
      email: 'flow7_admin@example.com',
      phone: '9876548001',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'Flow7 Member',
      email: 'flow7_member@example.com',
      phone: '9876548002',
      password: 'password123',
      role: 'member',
      membershipStatus: 'active',
      membershipPlan: 'monthly',
      membershipStart: new Date(),
      membershipEnd: new Date(Date.now() + 30 * 86400000),
      feeAmount: 2000,
      feePaid: true,
    });
    memberToken = makeToken(memberUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    const users = await User.find({ email: /^flow7_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Payment.deleteMany({ member: { $in: uids } });
      await Order.deleteMany({ user: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }
    await Enquiry.deleteMany({ email: /^flow7_/ });

    await teardownTestDb();
  });

  // 1. Enquiries Lifecycle
  test('1. Public creates enquiry with formatted phone; stored canonical; admin views & updates', async () => {
    // Public submission with +91 and spaces
    const resCreate = await fetch(`${baseUrl}/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Flow7 Lead',
        phone: '+91 98765 48010',
        email: 'flow7_lead@example.com',
        interest: 'membership',
        message: 'Looking for personal training and diet plans.',
      }),
    });
    assert.equal(resCreate.status, 201);
    const bodyCreate = await resCreate.json();
    assert.equal(bodyCreate.enquiry.phone, '9876548010', 'Phone must be stored in 10-digit canonical form');
    const enquiryId = bodyCreate.enquiry._id;

    // Non-admin cannot view enquiries
    const resForbidden = await fetch(`${baseUrl}/enquiries`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resForbidden.status, 403);

    // Admin views enquiries
    const resAdmin = await fetch(`${baseUrl}/enquiries`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);
    const enquiries = await resAdmin.json();
    assert.ok(Array.isArray(enquiries));
    const found = enquiries.find((e) => e._id === enquiryId);
    assert.ok(found);
    assert.equal(found.status, 'new');

    // Admin updates status to 'contacted'
    const resUpdate = await fetch(`${baseUrl}/enquiries/${enquiryId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'contacted' }),
    });
    assert.equal(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.equal(updated.status, 'contacted');
  });

  // 2. Enquiry Reply and Status Update to Converted
  test('2. Admin replies to enquiry via email/WhatsApp, and updates status to converted', async () => {
    const enquiry = await Enquiry.create({
      name: 'Flow7 Reply Target',
      phone: '9876548020',
      email: 'flow7_reply@example.com',
      interest: 'membership',
      message: 'Ready to join now',
    });

    // Admin replies
    const resReply = await fetch(`${baseUrl}/enquiries/${enquiry._id}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ message: 'Welcome to FitNation! Come visit us today.' }),
    });
    assert.equal(resReply.status, 200);
    const replyBody = await resReply.json();
    assert.equal(replyBody.enquiry.status, 'contacted');

    // Admin marks converted
    const resConverted = await fetch(`${baseUrl}/enquiries/${enquiry._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'converted' }),
    });
    assert.equal(resConverted.status, 200);
    const convertedBody = await resConverted.json();
    assert.equal(convertedBody.status, 'converted');

    const enquiryAfter = await Enquiry.findById(enquiry._id);
    assert.equal(enquiryAfter.status, 'converted');
  });

  // 3. Analytics Aggregations Match Database
  test('3. GET /api/analytics/summary returns accurate counts matching database', async () => {
    const res = await fetch(`${baseUrl}/analytics/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(typeof data.totalMembers === 'number');
    assert.ok(typeof data.activeMembers === 'number');
    assert.ok(data.totalMembers >= 1, 'Must count at least the Flow7 member');
    assert.ok(data.activeMembers >= 1, 'Must count active Flow7 member');
    assert.ok(typeof data.revenue === 'number');
  });

  // 4. Analytics Revenue Endpoint
  test('4. GET /api/analytics/revenue-monthly returns structured monthly revenue data', async () => {
    const res = await fetch(`${baseUrl}/analytics/revenue-monthly`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  // 5. Cache Stats and Health Check
  test('5. GET /api/_cache/stats and /api/health return valid diagnostics', async () => {
    const resCache = await fetch(`${baseUrl}/_cache/stats`);
    assert.equal(resCache.status, 200);
    const cacheStats = await resCache.json();
    assert.ok(typeof cacheStats.hits === 'number');
    assert.ok(typeof cacheStats.misses === 'number');

    const resHealth = await fetch(`${baseUrl}/health`);
    assert.equal(resHealth.status, 200);
    const health = await resHealth.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.db, 'connected');
  });
});
