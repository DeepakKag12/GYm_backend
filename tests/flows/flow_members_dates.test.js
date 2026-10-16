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
const Notification = require('../../src/models/Notification.model');
const { calcExpiry, daysRemaining, localDate } = require('../../src/utils/dateUtils');

describe('Flow 2: Members, Plans, Date Calculations & Expiry Boundaries E2E Flow', () => {
  let server;
  let membersUrl;
  let adminUser, adminToken;

  before(async () => {
    await setupTestDb();
    await User.deleteMany({ email: /^flow2_/ });

    adminUser = await User.create({
      name: 'Flow2 Admin',
      email: 'flow2_admin@example.com',
      phone: '9876550101',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    membersUrl = `http://127.0.0.1:${port}/api/members`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^flow2_/ });
    await teardownTestDb();
  });

  // 1. Plan Expiry Calculations for Month-end, Leap Year, and Durations
  test('1. calcExpiry handles Jan 31 + 1m in leap/non-leap years, Feb 29, and quarterly/half-yearly rollovers', () => {
    // Jan 31 + 1 month in 2024 (leap year) -> Feb 29, 2024
    const leapMonthly = calcExpiry('2024-01-31', 'monthly');
    assert.equal(localDate(leapMonthly), '2024-02-29');

    // Jan 31 + 1 month in 2023 (non-leap year) -> Feb 28, 2023
    const nonLeapMonthly = calcExpiry('2023-01-31', 'monthly');
    assert.equal(localDate(nonLeapMonthly), '2023-02-28');

    // Feb 29, 2024 (leap day) + yearly -> Feb 28, 2025
    const leapYearly = calcExpiry('2024-02-29', 'yearly');
    assert.equal(localDate(leapYearly), '2025-02-28');

    // Mar 31 + 3 months (quarterly) -> June 30
    const quarterly = calcExpiry('2024-03-31', 'quarterly');
    assert.equal(localDate(quarterly), '2024-06-30');

    // Aug 31 + 6 months (half-yearly) -> Feb 28 of next year
    const halfYearly = calcExpiry('2024-08-31', 'half-yearly');
    assert.equal(localDate(halfYearly), '2025-02-28');
  });

  // 2. daysRemaining in Asia/Kolkata (IST) timezone
  test('2. daysRemaining evaluates whole calendar days relative to IST', () => {
    // 2 days in the future
    const now = new Date('2026-05-10T12:00:00+05:30');
    const future = new Date('2026-05-12T00:00:00+05:30');
    assert.equal(daysRemaining(future, now), 2);

    // Same calendar day in IST
    const sameDay = new Date('2026-05-10T23:59:00+05:30');
    assert.equal(daysRemaining(sameDay, now), 0);

    // Expired 1 day ago in IST
    const past = new Date('2026-05-09T10:00:00+05:30');
    assert.equal(daysRemaining(past, now), -1);

    // Invalid dates return null
    assert.equal(daysRemaining(null, now), null);
    assert.equal(daysRemaining('invalid-date', now), null);
  });

  // 3. Member creation with auto expiry calculation and welcome notification
  test('3. Admin creates member with plan; auto-calculates membershipEnd and creates welcome notification', async () => {
    const res = await fetch(membersUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Leap Year Member',
        email: 'flow2_leap@example.com',
        phone: '9876550102',
        membershipPlan: 'monthly',
        membershipStart: '2024-01-31',
        feeAmount: 2000,
        initialPayment: 2000,
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.membershipPlan, 'monthly');
    assert.equal(localDate(new Date(data.membershipEnd)), '2024-02-29');
    assert.equal(data.feePaid, true);
    assert.equal(data.feeDueAmount, 0);

    // Welcome notification was created for this new member (sendWelcome is fire-and-forget)
    let notif = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      notif = await Notification.findOne({
        member: data._id,
        title: /welcome/i,
      });
      if (notif) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(notif, 'Welcome notification must be created upon member registration');
  });

  // 4. Duplicate phone and email rejection with 409
  test('4. Member creation rejects duplicate email or duplicate phone with 409', async () => {
    // Duplicate email
    const resDupEmail = await fetch(membersUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Another Person',
        email: 'flow2_leap@example.com',
        phone: '9876550199',
        membershipPlan: 'monthly',
      }),
    });
    assert.equal(resDupEmail.status, 409);
    const errEmail = await resDupEmail.json();
    assert.equal(errEmail.field, 'email');

    // Duplicate phone with country code prefix
    const resDupPhone = await fetch(membersUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Phone Duplicate',
        email: 'flow2_other_email@example.com',
        phone: '+91 98765 50102',
        membershipPlan: 'monthly',
      }),
    });
    assert.equal(resDupPhone.status, 409);
    const errPhone = await resDupPhone.json();
    assert.equal(errPhone.field, 'phone');
  });
});
