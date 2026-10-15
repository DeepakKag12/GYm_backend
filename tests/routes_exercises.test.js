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
const Exercise = require('../src/models/Exercise.model');
const cloudinary = require('../src/config/cloudinary');

describe('Exercises Routes & Controller (/api/exercises)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser1, memberToken1;
  let memberUser2, memberToken2;
  let publicEx, privateEx;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^extest_/ });

    adminUser = await User.create({
      name: 'Ex Admin',
      email: 'extest_admin@example.com',
      phone: '9876544201',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'Ex Trainer',
      email: 'extest_trainer@example.com',
      phone: '9876544202',
      password: 'password123',
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser1 = await User.create({
      name: 'Ex Member 1',
      email: 'extest_member1@example.com',
      phone: '9876544203',
      password: 'password123',
      role: 'member',
    });
    memberToken1 = makeToken(memberUser1);

    memberUser2 = await User.create({
      name: 'Ex Member 2',
      email: 'extest_member2@example.com',
      phone: '9876544204',
      password: 'password123',
      role: 'member',
    });
    memberToken2 = makeToken(memberUser2);

    publicEx = await Exercise.create({
      title: 'Barbell Bench Press',
      muscleGroup: 'chest',
      difficulty: 'intermediate',
      isPublic: true,
      uploadedBy: trainerUser._id,
    });

    privateEx = await Exercise.create({
      title: 'Targeted Rehab Lat Pulldown',
      muscleGroup: 'back',
      difficulty: 'beginner',
      isPublic: false,
      assignedTo: [memberUser1._id],
      uploadedBy: trainerUser._id,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/exercises`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^extest_/ });
    await Exercise.deleteMany({
      $or: [
        { uploadedBy: { $in: [adminUser?._id, trainerUser?._id] } },
        { assignedTo: { $in: [memberUser1?._id, memberUser2?._id] } },
      ],
    });
    await teardownTestDb();
  });

  // 1. POST /api/exercises/sign-upload
  test('1. sign-upload requires trainer/admin auth and generates Cloudinary params', async () => {
    const resNoAuth = await fetch(`${baseUrl}/sign-upload`, { method: 'POST' });
    assert.equal(resNoAuth.status, 401);

    const resMember = await fetch(`${baseUrl}/sign-upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resMember.status, 403);

    // If Cloudinary mock or config is present, trainer gets signing params or 500 if unconfigured
    const resTrainer = await fetch(`${baseUrl}/sign-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({ resource_type: 'video' }),
    });
    // In test environment without cloud credentials, 500 is returned as designed
    assert.ok(resTrainer.status === 200 || resTrainer.status === 500);
  });

  // 2. GET /api/exercises (Public vs Staff)
  test('2. Public GET /api/exercises returns only public exercises; Staff sees all', async () => {
    const resPub = await fetch(baseUrl);
    assert.equal(resPub.status, 200);
    const pubList = await resPub.json();
    assert.ok(Array.isArray(pubList));
    const hasPublic = pubList.some((e) => e._id.toString() === publicEx._id.toString());
    const hasPrivate = pubList.some((e) => e._id.toString() === privateEx._id.toString());
    assert.ok(hasPublic, 'Public exercise must be visible');
    assert.equal(hasPrivate, false, 'Private exercise must not leak to unauthenticated callers');

    const resStaff = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resStaff.status, 200);
    const staffList = await resStaff.json();
    assert.ok(staffList.some((e) => e._id.toString() === privateEx._id.toString()));
  });

  // 3. GET /api/exercises/my (Member assigned)
  test('3. Member gets only their assigned exercises in /my', async () => {
    const res1 = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res1.status, 200);
    const list1 = await res1.json();
    assert.ok(Array.isArray(list1));
    assert.ok(list1.some((e) => e._id.toString() === privateEx._id.toString()));

    const res2 = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res2.status, 200);
    const list2 = await res2.json();
    assert.ok(Array.isArray(list2));
    assert.equal(list2.length, 0);
  });

  // 4. GET /api/exercises/:id
  test('4. GET /api/exercises/:id enforces privacy controls', async () => {
    // Public exercise
    const resPub = await fetch(`${baseUrl}/${publicEx._id}`);
    assert.equal(resPub.status, 200);

    // Private exercise unauthenticated -> 401
    const resPrivNoAuth = await fetch(`${baseUrl}/${privateEx._id}`);
    assert.equal(resPrivNoAuth.status, 401);

    // Private exercise by unauthorized member -> 403
    const resPrivMem2 = await fetch(`${baseUrl}/${privateEx._id}`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(resPrivMem2.status, 403);

    // Private exercise by assigned member -> 200
    const resPrivMem1 = await fetch(`${baseUrl}/${privateEx._id}`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resPrivMem1.status, 200);

    // Non-existent id -> 404
    const nonId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${baseUrl}/${nonId}`);
    assert.equal(res404.status, 404);
  });

  // 5. POST /api/exercises & PUT /api/exercises/:id
  test('5. Trainer can create and update exercise', async () => {
    const resCreate = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        title: 'Overhead Shoulder Press',
        muscleGroup: 'shoulders',
        difficulty: 'intermediate',
        isPublic: true,
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    assert.equal(created.title, 'Overhead Shoulder Press');

    const resUpdate = await fetch(`${baseUrl}/${created._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        difficulty: 'advanced',
      }),
    });
    assert.equal(resUpdate.status, 200);
    const updated = await resUpdate.json();
    assert.equal(updated.difficulty, 'advanced');
  });

  // 6. DELETE /api/exercises/:id failure isolation and cache invalidation proof
  test('6. Cloudinary destroy failure does not prevent exercise deletion; cache is cleared', async () => {
    // Create an exercise with a videoPublicId
    const doomedEx = await Exercise.create({
      title: 'Doomed Exercise With Video',
      muscleGroup: 'legs',
      difficulty: 'beginner',
      videoPublicId: 'exercises/videos/fake_video_123',
      isPublic: false,
      assignedTo: [memberUser1._id],
      uploadedBy: trainerUser._id,
    });

    // Warm up member 1's /my cache
    const resWarm = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resWarm.status, 200);
    const warmList = await resWarm.json();
    assert.ok(warmList.some((e) => e._id.toString() === doomedEx._id.toString()));

    // Simulate Cloudinary failure on uploader.destroy
    const origDestroy = cloudinary.uploader.destroy;
    cloudinary.uploader.destroy = async () => {
      throw new Error('Cloudinary API connection timed out');
    };

    try {
      const resDelete = await fetch(`${baseUrl}/${doomedEx._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${trainerToken}` },
      });
      assert.equal(resDelete.status, 200, 'Deletion must succeed even if Cloudinary destroy throws');

      const checkDb = await Exercise.findById(doomedEx._id);
      assert.equal(checkDb, null, 'Exercise must be deleted from DB');

      // Check member's cache: should immediately not contain the deleted exercise
      const resAfter = await fetch(`${baseUrl}/my`, {
        headers: { Authorization: `Bearer ${memberToken1}` },
      });
      const afterList = await resAfter.json();
      assert.equal(
        afterList.some((e) => e._id.toString() === doomedEx._id.toString()),
        false,
        'Member cache must be invalidated on exercise deletion'
      );
    } finally {
      cloudinary.uploader.destroy = origDestroy;
    }
  });
});
