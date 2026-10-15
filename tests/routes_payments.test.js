const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('./test_helper');
const app = require('../src/app');
const User = require('../src/models/User.model');
const Payment = require('../src/models/Payment.model');

describe('Payments Routes & Controller (/api/payments)', () => {
  let server;
  let baseUrl;
  let adminUser;
  let adminToken;
  let memberUser;
  let memberToken;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^paytest_/ });
    await Payment.deleteMany({});

    adminUser = await User.create({
      name: 'Pay Admin',
      email: 'paytest_admin@example.com',
      phone: '9876543201',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'Pay Member',
      email: 'paytest_member@example.com',
      phone: '9876543202',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      feeAmount: 3000,
      feeDueAmount: 3000,
      feePaid: false,
    });
    memberToken = makeToken(memberUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/payments`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^paytest_/ });
    await Payment.deleteMany({});
    await teardownTestDb();
  });

  // 1. RBAC across payments endpoints
  test('1. Non-admin is blocked with 403 on GET /api/payments', async () => {
    const res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('2. Unauthenticated request is blocked with 401 on GET /api/payments', async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 401);
  });

  // 2. GET /api/payments
  test('3. Admin can GET /api/payments (returns payments, totals, counts)', async () => {
    const res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.payments));
    assert.ok(data.totals);
    assert.equal(typeof data.totals.all, 'number');
    assert.ok(data.counts);
  });

  // 3. GET /api/payments/due
  test('4. Admin can GET /api/payments/due (returns members list with due amount)', async () => {
    const res = await fetch(`${baseUrl}/due`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.members));
    assert.ok(data.total >= 3000);
    const found = data.members.find((m) => m._id.toString() === memberUser._id.toString());
    assert.ok(found);
    assert.equal(found.dueAmount, 3000);
  });

  // 4. POST /api/payments (recordPayment)
  test('5. recordPayment rejects non-positive amount and invalid member', async () => {
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ member: 'not-an-id', amount: 1000 }),
    });
    assert.equal(res1.status, 400);

    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ member: memberUser._id.toString(), amount: -50 }),
    });
    assert.equal(res2.status, 400);
  });

  test('6. recordPayment rejects payment amount greater than current due', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ member: memberUser._id.toString(), amount: 50000 }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /greater than/i);
  });

  test('7. recordPayment records partial payment and updates member feeDueAmount', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: memberUser._id.toString(),
        amount: 1000,
        method: 'upi',
        kind: 'adjustment',
        note: 'Partial payment test',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.remaining, 2000);

    const updated = await User.findById(memberUser._id);
    assert.equal(updated.feeDueAmount, 2000);
    assert.equal(updated.feePaid, false);
  });

  test('8. recordPayment supports idempotencyKey to prevent duplicate payment', async () => {
    const idempotencyKey = `pay_idem_${Date.now()}`;
    const payload = {
      member: memberUser._id.toString(),
      amount: 500,
      method: 'cash',
      idempotencyKey,
    };

    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res1.status, 201);
    const data1 = await res1.json();
    assert.equal(data1.remaining, 1500);

    // Call again with SAME idempotencyKey
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    // Must be idempotent (status 200 or 201, returning the same payment without charging again)
    assert.ok([200, 201].includes(res2.status), `Unexpected status: ${res2.status}`);
    const data2 = await res2.json();
    assert.equal(data2.payment._id, data1.payment._id);

    const updated = await User.findById(memberUser._id);
    assert.equal(updated.feeDueAmount, 1500); // Must NOT have subtracted 500 again to 1000!
  });

  // 5. GET /api/payments/summary
  test('9. Admin can GET /api/payments/summary', async () => {
    const res = await fetch(`${baseUrl}/summary`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.total);
    assert.ok(data.thisMonth);
    assert.ok(Array.isArray(data.series));
  });

  // 6. PDF Streaming: Statement and Receipt
  test('10. Admin can GET /api/payments/:memberId/statement (streams valid PDF)', async () => {
    const res = await fetch(`${baseUrl}/${memberUser._id}/statement`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = await res.arrayBuffer();
    const headerStr = Buffer.from(buf.slice(0, 5)).toString('utf8');
    assert.equal(headerStr, '%PDF-');
  });

  test('11. Admin can GET /api/payments/:paymentId/receipt (streams valid PDF)', async () => {
    const payment = await Payment.findOne({ member: memberUser._id });
    assert.ok(payment);

    const res = await fetch(`${baseUrl}/${payment._id}/receipt`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = await res.arrayBuffer();
    const headerStr = Buffer.from(buf.slice(0, 5)).toString('utf8');
    assert.equal(headerStr, '%PDF-');
  });

  // 7. Statement via Cloudinary and WhatsApp
  test('12. Admin can POST /api/payments/:memberId/statement (generates Cloudinary statement)', async () => {
    const res = await fetch(`${baseUrl}/${memberUser._id}/statement`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.url);
    assert.match(data.url, /cloudinary/);
  });

  test('13. Admin can POST /api/payments/:memberId/statement/whatsapp (sends via stubbed WhatsApp)', async () => {
    const res = await fetch(`${baseUrl}/${memberUser._id}/statement/whatsapp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.result);
  });

  // 8. Due management: addDuePayment, updateDuePayment, settleDuePayments
  test('14. addDuePayment sets fee due and accepts initial partial payment', async () => {
    const newMember = await User.create({
      name: 'Due Member',
      email: 'paytest_due@example.com',
      phone: '9876543203',
      password: 'password123',
      role: 'member',
    });

    const res = await fetch(`${baseUrl}/due`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: newMember._id.toString(),
        amount: 4000,
        paidAmount: 1500,
        method: 'cash',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.remaining, 2500);

    const updated = await User.findById(newMember._id);
    assert.equal(updated.feeDueAmount, 2500);
    assert.equal(updated.feePaid, false);
  });

  test('15. updateDuePayment updates member due amount', async () => {
    const res = await fetch(`${baseUrl}/due/${memberUser._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ dueAmount: 500 }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.dueAmount, 500);

    const updated = await User.findById(memberUser._id);
    assert.equal(updated.feeDueAmount, 500);
  });

  test('16. settleDuePayments marks selected due members as paid in a transaction', async () => {
    const res = await fetch(`${baseUrl}/due/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        memberIds: [memberUser._id.toString()],
        method: 'online',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.count, 1);

    const updated = await User.findById(memberUser._id);
    assert.equal(updated.feeDueAmount, 0);
    assert.equal(updated.feePaid, true);
  });

  // 9. Backfill payments
  test('17. backfillPayments creates payment rows for feePaid members without duplicates', async () => {
    const res = await fetch(`${baseUrl}/backfill`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.created, 'number');
    assert.equal(typeof data.skipped, 'number');
  });
});
