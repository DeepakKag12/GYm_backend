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
const DietPlan = require('../src/models/DietPlan.model');

describe('Diet Plans Routes & Controller (/api/diet)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser1, memberToken1;
  let memberUser2, memberToken2;
  let publicDiet, privateDiet;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^diettest_/ });

    adminUser = await User.create({
      name: 'Diet Admin',
      email: 'diettest_admin@example.com',
      phone: '9876544101',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'Diet Trainer',
      email: 'diettest_trainer@example.com',
      phone: '9876544102',
      password: 'password123',
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser1 = await User.create({
      name: 'Diet Member 1',
      email: 'diettest_member1@example.com',
      phone: '9876544103',
      password: 'password123',
      role: 'member',
    });
    memberToken1 = makeToken(memberUser1);

    memberUser2 = await User.create({
      name: 'Diet Member 2',
      email: 'diettest_member2@example.com',
      phone: '9876544104',
      password: 'password123',
      role: 'member',
    });
    memberToken2 = makeToken(memberUser2);

    publicDiet = await DietPlan.create({
      title: 'High Protein Public Diet',
      description: 'Standard 2000 kcal diet for public',
      goal: 'muscle-gain',
      isPublic: true,
      meals: [
        {
          mealType: 'breakfast',
          items: [{ name: 'Oats & Whey', quantity: '100g', calories: 450, protein: '35g' }],
        },
      ],
      uploadedBy: trainerUser._id,
    });

    privateDiet = await DietPlan.create({
      title: 'Personalized Cut Diet for Member 1',
      description: 'Strict 1600 kcal deficit',
      goal: 'weight-loss',
      isPublic: false,
      assignedTo: [memberUser1._id],
      meals: [
        {
          mealType: 'lunch',
          items: [{ name: 'Chicken Salad', quantity: '200g', calories: 350, protein: '40g' }],
        },
      ],
      uploadedBy: trainerUser._id,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/diet`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^diettest_/ });
    await DietPlan.deleteMany({
      $or: [
        { uploadedBy: { $in: [adminUser?._id, trainerUser?._id] } },
        { assignedTo: { $in: [memberUser1?._id, memberUser2?._id] } },
      ],
    });
    await teardownTestDb();
  });

  // 1. GET /api/diet (public vs staff)
  test('1. Unauthenticated or public GET /api/diet returns only public diet plans', async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    const plans = await res.json();
    assert.ok(Array.isArray(plans));
    const privateFound = plans.find((p) => p._id.toString() === privateDiet._id.toString());
    assert.equal(privateFound, undefined, 'Public should not see private diet plans');
    const publicFound = plans.find((p) => p._id.toString() === publicDiet._id.toString());
    assert.ok(publicFound, 'Public should see public diet plan');
  });

  test('2. Staff (trainer/admin) sees both public and private diet plans', async () => {
    const res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 200);
    const plans = await res.json();
    assert.ok(Array.isArray(plans));
    const privateFound = plans.find((p) => p._id.toString() === privateDiet._id.toString());
    assert.ok(privateFound, 'Trainer should see private diet plans');
  });

  // 2. GET /api/diet/my (assigned to member)
  test('3. Member gets only their assigned diet plans in /my', async () => {
    const res1 = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res1.status, 200);
    const plans1 = await res1.json();
    assert.ok(Array.isArray(plans1));
    assert.ok(plans1.some((p) => p._id.toString() === privateDiet._id.toString()));

    const res2 = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res2.status, 200);
    const plans2 = await res2.json();
    assert.ok(Array.isArray(plans2));
    assert.equal(plans2.length, 0);
  });

  // 3. GET /api/diet/:id
  test('4. GET /api/diet/:id: public plan is open, private plan enforces auth and assigned access', async () => {
    // Public plan
    const resPub = await fetch(`${baseUrl}/${publicDiet._id}`);
    assert.equal(resPub.status, 200);

    // Private plan unauthenticated -> 401
    const resPrivNoAuth = await fetch(`${baseUrl}/${privateDiet._id}`);
    assert.equal(resPrivNoAuth.status, 401);

    // Private plan by unauthorized member -> 403
    const resPrivMem2 = await fetch(`${baseUrl}/${privateDiet._id}`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(resPrivMem2.status, 403);

    // Private plan by assigned member -> 200
    const resPrivMem1 = await fetch(`${baseUrl}/${privateDiet._id}`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resPrivMem1.status, 200);

    // Non-existent plan -> 404
    const nonId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${baseUrl}/${nonId}`);
    assert.equal(res404.status, 404);
  });

  // 4. POST /api/diet & PUT /api/diet/:id
  test('5. Non-staff blocked with 403 on POST /api/diet; Trainer can create diet plan', async () => {
    const resMem = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({ title: 'Illegal Member Diet' }),
    });
    assert.equal(resMem.status, 403);

    const resCreate = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        title: 'Keto Kickstart',
        description: 'Low carb plan',
        goal: 'weight-loss',
        isPublic: false,
        assignedTo: [memberUser2._id.toString()],
        meals: [
          {
            mealType: 'dinner',
            items: [{ name: 'Paneer Tikka', quantity: '200g', calories: 400, protein: '25g' }],
          },
        ],
      }),
    });
    assert.equal(resCreate.status, 201);
    const created = await resCreate.json();
    assert.equal(created.title, 'Keto Kickstart');

    // Member 2 now sees it in /my
    const resMem2Check = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    const mem2Plans = await resMem2Check.json();
    assert.ok(mem2Plans.some((p) => p._id.toString() === created._id.toString()));
  });

  // 5. DELETE /api/diet/:id and stale cache invalidation proof
  test('6. Deleting assigned diet plan invalidates member cache immediately', async () => {
    // 1. Create a diet plan specifically assigned to member 1
    const resCreate = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        title: 'Temp Diet Plan For Cache Test',
        isPublic: false,
        assignedTo: [memberUser1._id.toString()],
      }),
    });
    assert.equal(resCreate.status, 201);
    const tempPlan = await resCreate.json();

    // 2. Member 1 fetches /my, caching the response under diet:member:${memberUser1._id}
    const resCachePopulate = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resCachePopulate.status, 200);
    const cachedList = await resCachePopulate.json();
    assert.ok(cachedList.some((p) => p._id.toString() === tempPlan._id.toString()));

    // 3. Trainer deletes the diet plan
    const resDelete = await fetch(`${baseUrl}/${tempPlan._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resDelete.status, 200);

    // 4. Member 1 immediately fetches /my: must NOT return the deleted diet plan
    const resFreshCheck = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resFreshCheck.status, 200);
    const freshList = await resFreshCheck.json();
    const stillPresent = freshList.some((p) => p._id.toString() === tempPlan._id.toString());
    assert.equal(stillPresent, false, 'Deleted diet plan must NOT be served from stale member cache');
  });
});
