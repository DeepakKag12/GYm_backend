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
const WorkoutSplit = require('../src/models/WorkoutSplit.model');

describe('Workout Splits Routes & Controller (/api/splits)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser, memberToken;
  let defaultSplit, memberSplit;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^splittest_/ });

    adminUser = await User.create({
      name: 'Split Admin',
      email: 'splittest_admin@example.com',
      phone: '9876544001',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'Split Trainer',
      email: 'splittest_trainer@example.com',
      phone: '9876544002',
      password: 'password123',
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser = await User.create({
      name: 'Split Member',
      email: 'splittest_member@example.com',
      phone: '9876544003',
      password: 'password123',
      role: 'member',
    });
    memberToken = makeToken(memberUser);

    defaultSplit = await WorkoutSplit.create({
      title: 'Default Full Body',
      createdBy: adminUser._id,
      goal: 'general',
      isDefault: true,
      isActive: true,
      days: [
        { day: 'Monday', focus: 'Full Body A', exercises: [], notes: '3x10' },
        { day: 'Wednesday', focus: 'Full Body B', exercises: [], notes: '3x10' },
        { day: 'Friday', focus: 'Full Body C', exercises: [], notes: '3x10' },
      ],
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/splits`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^splittest_/ });
    await WorkoutSplit.deleteMany({
      $or: [
        { createdBy: { $in: [adminUser?._id, trainerUser?._id, memberUser?._id] } },
        { member: memberUser?._id },
      ],
    });
    await teardownTestDb();
  });

  // 1. GET /api/splits/me
  test('1. Unauthenticated request to /me is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/me`);
    assert.equal(res.status, 401);
  });

  test('2. Member with no assigned split gets default split', async () => {
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data);
    assert.equal(data.title, 'Default Full Body');
    assert.equal(data.isDefault, true);
  });

  test('3. Member with assigned split receives their assigned split', async () => {
    const resCreate = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        title: 'Custom Member Split',
        member: memberUser._id.toString(),
        goal: 'muscle',
        isDefault: false,
        isActive: true,
        days: [
          { day: 'Monday', focus: 'Upper Body', exercises: [], notes: 'Push' },
          { day: 'Tuesday', focus: 'Lower Body', exercises: [], notes: 'Legs' },
        ],
      }),
    });
    assert.equal(resCreate.status, 201);
    memberSplit = await resCreate.json();

    const res = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.title, 'Custom Member Split');
    assert.equal(data.member.toString(), memberUser._id.toString());
  });

  // 2. GET /api/splits/planner and PUT /api/splits/planner
  test('4. Member can access their personal planner (auto-initialized)', async () => {
    const res = await fetch(`${baseUrl}/planner`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 200);
    const planner = await res.json();
    assert.equal(planner.title, '__personal_planner__');
    assert.equal(planner.member.toString(), memberUser._id.toString());
    assert.equal(planner.days.length, 7);
  });

  test('5. PUT /api/splits/planner validates days array and saves changes', async () => {
    // Bad request: missing days
    const resBad = await fetch(`${baseUrl}/planner`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ days: 'not-an-array' }),
    });
    assert.equal(resBad.status, 400);

    // Good request
    const updatedDays = [
      { day: 'Monday', focus: 'Chest Day', exercises: [], notes: 'Bench Press heavy' },
      { day: 'Tuesday', focus: 'Back Day', exercises: [], notes: 'Deadlifts' },
    ];
    const resGood = await fetch(`${baseUrl}/planner`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ days: updatedDays }),
    });
    assert.equal(resGood.status, 200);
    const saved = await resGood.json();
    assert.equal(saved.days.length, 2);
    assert.equal(saved.days[0].focus, 'Chest Day');
  });

  // 3. GET /api/splits (Staff only)
  test('6. Non-staff is blocked with 403 on GET /api/splits, Trainer and Admin can access', async () => {
    const resMember = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resMember.status, 403);

    const resTrainer = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resTrainer.status, 200);
    const trainerList = await resTrainer.json();
    assert.ok(Array.isArray(trainerList));

    const resAdmin = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);
    const adminList = await resAdmin.json();
    assert.ok(Array.isArray(adminList));
  });

  // 4. POST /api/splits
  test('7. Trainer can create new split, isDefault manages other defaults', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        title: 'New Default Split',
        goal: 'strength',
        isDefault: true,
        days: [{ day: 'Monday', focus: 'Compound Lifts', exercises: [], notes: '5x5' }],
      }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.title, 'New Default Split');
    assert.equal(created.isDefault, true);

    // Old default split should now have isDefault = false
    const oldDefault = await WorkoutSplit.findById(defaultSplit._id);
    assert.equal(oldDefault.isDefault, false);
  });

  // 5. PUT /api/splits/:id and DELETE /api/splits/:id
  test('8. Staff can update split, returns 404 for nonexistent split', async () => {
    const nonId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${baseUrl}/${nonId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({ title: 'Ghost Split' }),
    });
    assert.equal(res404.status, 404);

    const resUpdate = await fetch(`${baseUrl}/${memberSplit._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({ title: 'Updated Member Split' }),
    });
    assert.equal(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.equal(updated.title, 'Updated Member Split');
  });

  test('9. Staff can delete split, non-staff blocked with 403', async () => {
    const resForbidden = await fetch(`${baseUrl}/${memberSplit._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resForbidden.status, 403);

    const resDelete = await fetch(`${baseUrl}/${memberSplit._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resDelete.status, 200);
    const check = await WorkoutSplit.findById(memberSplit._id);
    assert.equal(check, null);
  });
});
