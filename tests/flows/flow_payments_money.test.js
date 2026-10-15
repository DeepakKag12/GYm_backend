const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('../test_helper');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Payment = require('../../src/models/Payment.model');

describe('Flow 3: Payments, Money, Ledger & Settle-Due E2E Flow', () => {
  let server;
  let baseUrl;
  let adminUser;
  let adminToken;
  let membersUrl;

  before(async () => {
    await setupTestDb();

    // Clean up only Flow 3 records
    const existingUsers = await User.find({ email: /^flow3_/ }).select('_id');
    const userIds = existingUsers.map((u) => u._id);
    if (userIds.length > 0) {
      await Payment.deleteMany({ member: { $in: userIds } });
      await User.deleteMany({ _id: { $in: userIds } });
    }

    adminUser = await User.create({
      name: 'Flow3 Admin',
      email: 'flow3_admin@example.com',
      phone: '9876543301',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/payments`;
    membersUrl = `http://127.0.0.1:${port}/api/members`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const users = await User.find({ email: /^flow3_/ }).select('_id');
    const ids = users.map((u) => u._id);
    if (ids.length > 0) {
      await Payment.deleteMany({ member: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await teardownTestDb();
  });

  // 1. Renewal while active vs expired
  test('1. Member renewal while active creates renewal payment and resets reminder flags', async () => {
    const activeMember = await User.create({
      name: 'Flow3 Active Member',
      email: 'flow3_active@example.com',
      phone: '9876543302',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStart: new Date('2026-10-01'),
      membershipEnd: new Date('2026-11-01'),
      membershipStatus: 'active',
      feeAmount: 2000,
      feeDueAmount: 0,
      feePaid: true,
      reminderSent7days: true,
      reminderSent3days: true,
    });

    const res = await fetch(`${membersUrl}/${activeMember._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        membershipEnd: '2026-12-01',
        feeAmount: 2500,
        initialPayment: 2500,
        paymentMethod: 'upi',
      }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.feePaid, true);
    assert.equal(updated.feeDueAmount, 0);
    assert.equal(updated.reminderSent7days, false);

    // Verify renewal Payment was recorded
    const payment = await Payment.findOne({
      member: activeMember._id,
      kind: 'renewal',
      amount: 2500,
    });
    assert.ok(payment, 'Renewal payment must be recorded in payment ledger');
    assert.equal(payment.method, 'upi');
  });

  test('2. Member renewal while expired restores active status and handles partial payment', async () => {
    const expiredMember = await User.create({
      name: 'Flow3 Expired Member',
      email: 'flow3_expired@example.com',
      phone: '9876543303',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStart: new Date('2026-08-01'),
      membershipEnd: new Date('2026-09-01'),
      membershipStatus: 'expired',
      feeAmount: 2000,
      feeDueAmount: 0,
      feePaid: true,
    });

    const res = await fetch(`${membersUrl}/${expiredMember._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        membershipEnd: '2026-11-30',
        feeAmount: 3000,
        initialPayment: 2000,
        paymentMethod: 'cash',
      }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.membershipStatus, 'active');
    assert.equal(updated.feeAmount, 3000);
    assert.equal(updated.feeDueAmount, 1000);
    assert.equal(updated.feePaid, false);

    const payment = await Payment.findOne({
      member: expiredMember._id,
      kind: 'renewal',
      amount: 2000,
    });
    assert.ok(payment);
  });

  // 2. Partial payments, overpayment guards & idempotency
  test('3. recordPayment validates amount bounds (zero, negative, overpayment)', async () => {
    const member = await User.create({
      name: 'Flow3 Bounds Member',
      email: 'flow3_bounds@example.com',
      phone: '9876543304',
      password: 'password123',
      role: 'member',
      feeAmount: 2000,
      feeDueAmount: 1000,
      feePaid: false,
    });

    // Zero amount
    const resZero = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 0,
      }),
    });
    assert.equal(resZero.status, 400);

    // Negative amount
    const resNeg = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: -500,
      }),
    });
    assert.equal(resNeg.status, 400);

    // Overpayment (> currentDue)
    const resOver = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 1500,
      }),
    });
    assert.equal(resOver.status, 400);
    const overBody = await resOver.json();
    assert.match(overBody.message, /cannot be greater than the remaining due/i);
  });

  test('4. recordPayment records partial payment, prevents duplicates via idempotencyKey, and settles final due', async () => {
    const member = await User.create({
      name: 'Flow3 Idempotency Member',
      email: 'flow3_idem@example.com',
      phone: '9876543305',
      password: 'password123',
      role: 'member',
      feeAmount: 3000,
      feeDueAmount: 3000,
      feePaid: false,
    });

    const idemKey = 'flow3_idem_test_key_001';

    // First payment: ₹1000 of ₹3000
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 1000,
        idempotencyKey: idemKey,
      }),
    });
    assert.equal(res1.status, 201);
    const body1 = await res1.json();
    assert.equal(body1.remaining, 2000);

    const memAfter1 = await User.findById(member._id);
    assert.equal(memAfter1.feeDueAmount, 2000);
    assert.equal(memAfter1.feePaid, false);

    // Duplicate request with SAME idempotencyKey -> must return 200 without extra charge
    const resDup = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 1000,
        idempotencyKey: idemKey,
      }),
    });
    assert.equal(resDup.status, 200);
    const bodyDup = await resDup.json();
    assert.match(bodyDup.message, /already recorded/i);
    assert.equal(bodyDup.remaining, 2000);

    const paymentsForIdem = await Payment.countDocuments({
      member: member._id,
      idempotencyKey: idemKey,
    });
    assert.equal(paymentsForIdem, 1, 'Only one Payment document must exist for the idempotencyKey');

    // Final balance payment: ₹2000 -> settles to ₹0 and feePaid = true
    const resFinal = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 2000,
        idempotencyKey: 'flow3_idem_test_key_002',
      }),
    });
    assert.equal(resFinal.status, 201);
    const bodyFinal = await resFinal.json();
    assert.equal(bodyFinal.remaining, 0);

    const memFinal = await User.findById(member._id);
    assert.equal(memFinal.feeDueAmount, 0);
    assert.equal(memFinal.feePaid, true);
  });

  // 3. Floating point precision
  test('5. Floating point decimal payments calculate remaining balance accurately without drift', async () => {
    const member = await User.create({
      name: 'Flow3 Float Member',
      email: 'flow3_float@example.com',
      phone: '9876543306',
      password: 'password123',
      role: 'member',
      feeAmount: 1000,
      feeDueAmount: 1000,
      feePaid: false,
    });

    // Pay 333.33
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 333.33,
      }),
    });
    assert.equal(res1.status, 201);
    const body1 = await res1.json();
    assert.equal(Math.round(body1.remaining * 100) / 100, 666.67);

    // Pay remaining 666.67
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        member: member._id.toString(),
        amount: 666.67,
      }),
    });
    assert.equal(res2.status, 201);
    const body2 = await res2.json();
    assert.equal(body2.remaining, 0);

    const finalMember = await User.findById(member._id);
    assert.equal(finalMember.feePaid, true);
    assert.equal(finalMember.feeDueAmount, 0);
  });

  // 4. Multi-document transaction bulk settle
  test('6. settleDuePayments marks all selected due members as paid in a single atomic transaction', async () => {
    const m1 = await User.create({
      name: 'Flow3 Settle 1',
      email: 'flow3_settle1@example.com',
      phone: '9876543307',
      password: 'password123',
      role: 'member',
      feeAmount: 1500,
      feeDueAmount: 1500,
      feePaid: false,
    });
    const m2 = await User.create({
      name: 'Flow3 Settle 2',
      email: 'flow3_settle2@example.com',
      phone: '9876543308',
      password: 'password123',
      role: 'member',
      feeAmount: 2200,
      feeDueAmount: 2200,
      feePaid: false,
    });

    const res = await fetch(`${baseUrl}/due/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        memberIds: [m1._id.toString(), m2._id.toString()],
        method: 'card',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.count, 2);
    assert.equal(body.skipped, 0);

    const checkM1 = await User.findById(m1._id);
    const checkM2 = await User.findById(m2._id);
    assert.equal(checkM1.feeDueAmount, 0);
    assert.equal(checkM1.feePaid, true);
    assert.equal(checkM2.feeDueAmount, 0);
    assert.equal(checkM2.feePaid, true);

    const p1 = await Payment.findOne({ member: m1._id, amount: 1500 });
    const p2 = await Payment.findOne({ member: m2._id, amount: 2200 });
    assert.ok(p1, 'Payment record created for settled member 1');
    assert.ok(p2, 'Payment record created for settled member 2');
    assert.equal(p1.method, 'card');
  });

  // 5. Payments listing & totals match individual payments
  test('7. GET /api/payments returns all membership payments with correct aggregated totals', async () => {
    const res = await fetch(`${baseUrl}?source=membership`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.payments));
    assert.ok(typeof data.totals.membership === 'number');

    // Totals in response must equal sum of payments array
    const calculatedSum = data.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    assert.equal(data.totals.membership, calculatedSum);
  });
});
