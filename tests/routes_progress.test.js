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
const ProgressEntry = require('../src/models/ProgressEntry.model');

describe('Progress Routes & Controller (/api/progress)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser1, memberToken1;
  let memberUser2, memberToken2;
  let entry1;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^progtest_/ });

    adminUser = await User.create({
      name: 'Prog Admin',
      email: 'progtest_admin@example.com',
      phone: '9876543901',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'Prog Trainer',
      email: 'progtest_trainer@example.com',
      phone: '9876543902',
      password: 'password123',
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser1 = await User.create({
      name: 'Prog Member 1',
      email: 'progtest_member1@example.com',
      phone: '9876543903',
      password: 'password123',
      role: 'member',
    });
    memberToken1 = makeToken(memberUser1);

    memberUser2 = await User.create({
      name: 'Prog Member 2',
      email: 'progtest_member2@example.com',
      phone: '9876543904',
      password: 'password123',
      role: 'member',
    });
    memberToken2 = makeToken(memberUser2);

    entry1 = await ProgressEntry.create({
      member: memberUser1._id,
      date: new Date(),
      weight: 75.5,
      bodyFat: 18,
      waist: 32,
      chest: 40,
      notes: 'Feeling energized',
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/progress`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^progtest_/ });
    await ProgressEntry.deleteMany({ member: { $in: [memberUser1?._id, memberUser2?._id] } });
    await teardownTestDb();
  });

  // 1. GET /api/progress/me & GET /api/progress
  test('1. Member can fetch their own progress entries, Member 2 gets empty array', async () => {
    const res1 = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res1.status, 200);
    const list1 = await res1.json();
    assert.ok(Array.isArray(list1));
    assert.equal(list1.length, 1);
    assert.equal(list1[0].weight, 75.5);

    const res2 = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res2.status, 200);
    const list2 = await res2.json();
    assert.ok(Array.isArray(list2));
    assert.equal(list2.length, 0); // Member 2 has no progress entries
  });

  // 2. GET /api/progress/:memberId (trainerOrAdmin)
  test('2. Member cannot view other member progress (IDOR defense), Trainer and Admin can', async () => {
    // Member 2 tries to view Member 1's progress
    const resMember = await fetch(`${baseUrl}/${memberUser1._id}`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(resMember.status, 403);

    // Trainer can view Member 1's progress
    const resTrainer = await fetch(`${baseUrl}/${memberUser1._id}`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resTrainer.status, 200);
    const listTrainer = await resTrainer.json();
    assert.ok(Array.isArray(listTrainer));
    assert.equal(listTrainer.length, 1);

    // Admin can view Member 1's progress
    const resAdmin = await fetch(`${baseUrl}/${memberUser1._id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);
    const listAdmin = await resAdmin.json();
    assert.ok(Array.isArray(listAdmin));
  });

  // 3. POST /api/progress (create entry)
  test('3. Member can create new progress entry', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({
        date: new Date(),
        weight: 74.8,
        waist: 31.5,
        notes: 'Down 0.7kg this week',
      }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.weight, 74.8);
    assert.equal(created.member, memberUser1._id.toString());
  });

  // 4. DELETE /api/progress/:id (IDOR defense & deletion)
  test('4. Member 2 cannot delete Member 1 progress entry (IDOR defense)', async () => {
    const res = await fetch(`${baseUrl}/${entry1._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res.status, 403);

    const check = await ProgressEntry.findById(entry1._id);
    assert.ok(check);
  });

  test('5. Owner can delete their own progress entry', async () => {
    const res = await fetch(`${baseUrl}/${entry1._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 200);

    const check = await ProgressEntry.findById(entry1._id);
    assert.equal(check, null);
  });
});
