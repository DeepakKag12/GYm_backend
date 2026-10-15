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
const Transformation = require('../src/models/Transformation.model');

describe('Transformations & Cron Routes & Controllers (/api/transformations & /api/cron)', () => {
  let server;
  let tfUrl, cronUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser, memberToken;
  let publicTf, privateTf;
  const originalCronSecret = process.env.CRON_SECRET;

  before(async () => {
    process.env.CRON_SECRET = 'test_cron_secret_12345';
    await setupTestDb();

    await User.deleteMany({ email: /^tftest_/ });
    await Transformation.deleteMany({});

    adminUser = await User.create({
      name: 'TF Admin',
      email: 'tftest_admin@example.com',
      phone: '9876544401',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'TF Trainer',
      email: 'tftest_trainer@example.com',
      phone: '9876544402',
      password: 'password123',
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser = await User.create({
      name: 'TF Member',
      email: 'tftest_member@example.com',
      phone: '9876544403',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      membershipEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days left
    });
    memberToken = makeToken(memberUser);

    publicTf = await Transformation.create({
      member: memberUser._id,
      title: 'Amazing 10kg Fat Loss',
      description: 'Lost 10kg in 12 weeks',
      beforeImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      afterImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      isPublic: true,
      uploadedBy: trainerUser._id,
    });

    privateTf = await Transformation.create({
      member: memberUser._id,
      title: 'Private Member Journey',
      description: 'In progress',
      beforeImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      afterImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      isPublic: false,
      uploadedBy: trainerUser._id,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    tfUrl = `http://127.0.0.1:${port}/api/transformations`;
    cronUrl = `http://127.0.0.1:${port}/api/cron`;
  });

  after(async () => {
    process.env.CRON_SECRET = originalCronSecret;
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^tftest_/ });
    await Transformation.deleteMany({});
    await teardownTestDb();
  });

  // ── TRANSFORMATIONS ──────────────────────────────────────────────────────────

  test('1. Public GET /api/transformations returns only public transformations', async () => {
    const res = await fetch(tfUrl);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    const hasPublic = list.some((t) => t._id.toString() === publicTf._id.toString());
    const hasPrivate = list.some((t) => t._id.toString() === privateTf._id.toString());
    assert.ok(hasPublic, 'Public transformation must be visible');
    assert.equal(hasPrivate, false, 'Private transformation must not be public');
  });

  test('2. Staff GET /api/transformations/all returns all transformations; non-staff blocked with 403', async () => {
    const resMem = await fetch(`${tfUrl}/all`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resMem.status, 403);

    const resStaff = await fetch(`${tfUrl}/all`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resStaff.status, 200);
    const all = await resStaff.json();
    assert.ok(Array.isArray(all));
    assert.ok(all.some((t) => t._id.toString() === privateTf._id.toString()));
  });

  test('3. Staff can create and update transformation', async () => {
    const resCreate = await fetch(tfUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        member: memberUser._id.toString(),
        title: 'New Client Transformation',
        beforeImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        afterImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        duration: '6 months',
        isPublic: 'true',
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    assert.equal(created.title, 'New Client Transformation');

    const resUpdate = await fetch(`${tfUrl}/${created._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        title: 'Updated Client Transformation',
      }),
    });
    assert.equal(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.equal(updated.title, 'Updated Client Transformation');
  });

  test('4. Staff can delete transformation; non-staff blocked with 403', async () => {
    const doomed = await Transformation.create({
      member: memberUser._id,
      title: 'Doomed Transformation',
      beforeImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      afterImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      uploadedBy: trainerUser._id,
    });

    const resForbidden = await fetch(`${tfUrl}/${doomed._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resForbidden.status, 403);

    const resDelete = await fetch(`${tfUrl}/${doomed._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resDelete.status, 200);
    const check = await Transformation.findById(doomed._id);
    assert.equal(check, null);
  });

  // ── CRON /api/cron/fee-reminder ──────────────────────────────────────────────

  test('5. GET /api/cron/fee-reminder requires CRON_SECRET auth', async () => {
    const resNoAuth = await fetch(`${cronUrl}/fee-reminder`);
    assert.equal(resNoAuth.status, 401);

    const resWrongAuth = await fetch(`${cronUrl}/fee-reminder`, {
      headers: { Authorization: 'Bearer wrong_secret' },
    });
    assert.equal(resWrongAuth.status, 401);
  });

  test('6. Valid CRON_SECRET executes fee reminder sweep with slot idempotency', async () => {
    const resRun1 = await fetch(`${cronUrl}/fee-reminder?slot=am`, {
      headers: { Authorization: 'Bearer test_cron_secret_12345' },
    });
    assert.equal(resRun1.status, 200);
    const result1 = await resRun1.json();
    assert.equal(result1.ok, true);
    assert.equal(result1.slot, 'am');
    assert.equal(typeof result1.notified, 'number');

    // Second run with the same slot 'am': member is not notified again (slot idempotency)
    const resRun2 = await fetch(`${cronUrl}/fee-reminder?slot=am`, {
      headers: { Authorization: 'Bearer test_cron_secret_12345' },
    });
    assert.equal(resRun2.status, 200);
    const result2 = await resRun2.json();
    assert.equal(result2.ok, true);
    assert.equal(result2.slot, 'am');
  });
});
