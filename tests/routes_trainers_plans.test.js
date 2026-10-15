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
const MembershipPlan = require('../src/models/MembershipPlan.model');

describe('Trainers & Plans Routes & Controllers (/api/trainers & /api/plans)', () => {
  let server;
  let trainersUrl, plansUrl;
  let adminUser, adminToken;
  let memberUser, memberToken;
  let activeTrainer, inactiveTrainer;
  let activePlan, inactivePlan;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^tptest_/ });
    await MembershipPlan.deleteMany({ slug: /^tptest_/ });

    adminUser = await User.create({
      name: 'TP Admin',
      email: 'tptest_admin@example.com',
      phone: '9876544301',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'TP Member',
      email: 'tptest_member@example.com',
      phone: '9876544302',
      password: 'password123',
      role: 'member',
    });
    memberToken = makeToken(memberUser);

    activeTrainer = await User.create({
      name: 'TP Active Trainer',
      email: 'tptest_act_trainer@example.com',
      phone: '9876544303',
      password: 'password123',
      role: 'trainer',
      specialization: 'Hypertrophy',
      isActive: true,
    });

    inactiveTrainer = await User.create({
      name: 'TP Inactive Trainer',
      email: 'tptest_inact_trainer@example.com',
      phone: '9876544304',
      password: 'password123',
      role: 'trainer',
      specialization: 'Yoga',
      isActive: false,
    });

    activePlan = await MembershipPlan.create({
      name: 'TP 1 Month',
      slug: 'tptest_monthly',
      durationDays: 30,
      price: 1500,
      isActive: true,
    });

    inactivePlan = await MembershipPlan.create({
      name: 'TP Promo 1 Year',
      slug: 'tptest_yearly_promo',
      durationDays: 365,
      price: 12000,
      isActive: false,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    trainersUrl = `http://127.0.0.1:${port}/api/trainers`;
    plansUrl = `http://127.0.0.1:${port}/api/plans`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^tptest_/ });
    await MembershipPlan.deleteMany({ slug: /^tptest_/ });
    await teardownTestDb();
  });

  // ── TRAINERS ENDPOINTS ────────────────────────────────────────────────────────

  test('1. Public GET /api/trainers returns only active trainers without password', async () => {
    const res = await fetch(trainersUrl);
    assert.equal(res.status, 200);
    const trainers = await res.json();
    assert.ok(Array.isArray(trainers));
    const hasActive = trainers.some((t) => t._id.toString() === activeTrainer._id.toString());
    const hasInactive = trainers.some((t) => t._id.toString() === inactiveTrainer._id.toString());
    assert.ok(hasActive, 'Active trainer must be returned');
    assert.equal(hasInactive, false, 'Inactive trainer must not be returned on public route');
    trainers.forEach((t) => assert.equal(t.password, undefined));
  });

  test('2. Admin GET /api/trainers?all=1 returns both active and inactive trainers', async () => {
    const res = await fetch(`${trainersUrl}?all=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const trainers = await res.json();
    assert.ok(trainers.some((t) => t._id.toString() === activeTrainer._id.toString()));
    assert.ok(trainers.some((t) => t._id.toString() === inactiveTrainer._id.toString()));
  });

  test('3. Admin can create trainer, duplicate email/phone rejected with 409', async () => {
    const resNoAuth = await fetch(trainersUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacker Trainer' }),
    });
    assert.equal(resNoAuth.status, 401);

    const resMember = await fetch(trainersUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ name: 'Hacker Trainer' }),
    });
    assert.equal(resMember.status, 403);

    // Duplicate email
    const resClash = await fetch(trainersUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Clash Trainer',
        email: 'tptest_act_trainer@example.com',
        phone: '9876544399',
      }),
    });
    assert.equal(resClash.status, 409);

    // Valid create
    const resCreate = await fetch(trainersUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'New Coach',
        email: 'tptest_new_coach@example.com',
        phone: '9876544305',
        specialization: 'Strength & Conditioning',
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    assert.equal(created.name, 'New Coach');
    assert.equal(created.role, 'trainer');
    assert.equal(created.password, undefined);
  });

  test('4. Admin can update trainer, non-existent returns 404', async () => {
    const nonId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${trainersUrl}/${nonId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ specialization: 'Calisthenics' }),
    });
    assert.equal(res404.status, 404);

    const resUpdate = await fetch(`${trainersUrl}/${activeTrainer._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ specialization: 'Powerlifting' }),
    });
    assert.equal(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.equal(updated.specialization, 'Powerlifting');
  });

  test('5. Admin can delete trainer; unsets assignedTrainer on members', async () => {
    const doomedTrainer = await User.create({
      name: 'Doomed Coach',
      email: 'tptest_doomed_coach@example.com',
      phone: '9876544306',
      password: 'password123',
      role: 'trainer',
    });

    const trainee = await User.create({
      name: 'Trainee Member',
      email: 'tptest_trainee@example.com',
      phone: '9876544307',
      password: 'password123',
      role: 'member',
      assignedTrainer: doomedTrainer._id,
    });

    const resDelete = await fetch(`${trainersUrl}/${doomedTrainer._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resDelete.status, 200);

    const checkTrainer = await User.findById(doomedTrainer._id);
    assert.equal(checkTrainer, null);

    const checkTrainee = await User.findById(trainee._id);
    assert.equal(checkTrainee.assignedTrainer, undefined);

    // Guard: calling deleteTrainer on an admin account is blocked with 400
    const resDeleteAdmin = await fetch(`${trainersUrl}/${adminUser._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resDeleteAdmin.status, 400);
    const errData = await resDeleteAdmin.json();
    assert.match(errData.message, /not a trainer/i);

    const checkAdminStillExists = await User.findById(adminUser._id);
    assert.ok(checkAdminStillExists);
  });

  // ── PLANS ENDPOINTS ───────────────────────────────────────────────────────────

  test('6. Public GET /api/plans returns active plans; ?all=1 returns all', async () => {
    const resPub = await fetch(plansUrl);
    assert.equal(resPub.status, 200);
    const pubPlans = await resPub.json();
    assert.ok(Array.isArray(pubPlans));
    assert.ok(pubPlans.some((p) => p.slug === 'tptest_monthly'));
    assert.equal(pubPlans.some((p) => p.slug === 'tptest_yearly_promo'), false);

    const resAll = await fetch(`${plansUrl}?all=1`);
    assert.equal(resAll.status, 200);
    const allPlans = await resAll.json();
    assert.ok(allPlans.some((p) => p.slug === 'tptest_monthly'));
    assert.ok(allPlans.some((p) => p.slug === 'tptest_yearly_promo'));
  });

  test('7. Admin can create plan; validates required fields', async () => {
    const resBad = await fetch(plansUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'Incomplete Plan' }), // missing slug, durationDays, price
    });
    assert.equal(resBad.status, 400);

    const resCreate = await fetch(plansUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'TP 3 Months',
        slug: 'tptest_quarterly',
        durationDays: 90,
        price: 4000,
        features: ['Gym Access', 'Locker Room'],
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    assert.equal(created.name, 'TP 3 Months');
    assert.equal(created.durationDays, 90);
  });

  test('8. Admin can update and delete plan; handles 404 for nonexistent plan', async () => {
    const nonId = new mongoose.Types.ObjectId();
    const resUpdate404 = await fetch(`${plansUrl}/${nonId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ price: 4200 }),
    });
    assert.equal(resUpdate404.status, 404);

    const resDelete404 = await fetch(`${plansUrl}/${nonId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resDelete404.status, 404);

    const resUpdate = await fetch(`${plansUrl}/${activePlan._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ price: 1600 }),
    });
    assert.equal(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.equal(updated.price, 1600);

    const resDelete = await fetch(`${plansUrl}/${activePlan._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resDelete.status, 200);
    const check = await MembershipPlan.findById(activePlan._id);
    assert.equal(check, null);
  });
});
