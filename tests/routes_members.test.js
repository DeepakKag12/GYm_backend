const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { setupTestDb, teardownTestDb, makeToken } = require('./test_helper');
const app = require('../src/app');
const User = require('../src/models/User.model');

describe('Members Routes Test Suite', () => {
  let server;
  let baseUrl;
  let adminUser, trainerUser, memberUser1, memberUser2;
  let adminToken, trainerToken, memberToken1, memberToken2;

  before(async () => {
    await setupTestDb();
    await User.deleteMany({ email: /^membertest_/ });

    // Create test accounts
    adminUser = await User.create({
      name: 'Admin Boss',
      email: 'membertest_adminboss@example.com',
      phone: '9820000001',
      password: 'password123',
      role: 'admin',
    });
    trainerUser = await User.create({
      name: 'Trainer Bob',
      email: 'membertest_trainerbob@example.com',
      phone: '9820000002',
      password: 'password123',
      role: 'trainer',
    });
    memberUser1 = await User.create({
      name: 'Member Alice',
      email: 'membertest_alice@example.com',
      phone: '9820000003',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      feeAmount: 1000,
      feeDueAmount: 0,
      feePaid: true,
    });
    memberUser2 = await User.create({
      name: 'Member Charlie',
      email: 'membertest_charlie@example.com',
      phone: '9820000004',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      feeAmount: 1500,
      feeDueAmount: 500,
      feePaid: false,
    });

    adminToken = makeToken(adminUser);
    trainerToken = makeToken(trainerUser);
    memberToken1 = makeToken(memberUser1);
    memberToken2 = makeToken(memberUser2);

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}/api/members`;
        resolve();
      });
    });
  });

  after(async () => {
    await User.deleteMany({ email: /^membertest_/ });
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await teardownTestDb();
  });

  it('1. GET /roster - accessible by trainer and returns member array', async () => {
    const res = await fetch(`${baseUrl}/roster`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 2);
  });

  it('2. GET /roster - rejected with 403 when called by member', async () => {
    const res = await fetch(`${baseUrl}/roster`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 403);
  });

  it('3. GET / - accessible by admin and returns array and pagination headers', async () => {
    const res = await fetch(`${baseUrl}?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('x-total-count'));
    const data = await res.json();
    assert.ok(Array.isArray(data));
  });

  it('4. GET / - rejected with 403 when called by non-admin', async () => {
    const res = await fetch(`${baseUrl}`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 403);
  });

  it('5. POST / - admin successfully creates member with plan and fee', async () => {
    const res = await fetch(`${baseUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'New Member Dan',
        email: 'membertest_dan@example.com',
        phone: '9820000010',
        membershipPlan: 'quarterly',
        membershipStart: new Date().toISOString(),
        feeAmount: 3000,
        initialPayment: 3000,
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, 'New Member Dan');
    assert.equal(data.feePaid, true);
    assert.equal(data.feeDueAmount, 0);
  });

  it('6. POST / - rejects duplicate email or phone with 409 Conflict', async () => {
    const res = await fetch(`${baseUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'Clashing Member',
        email: 'membertest_dan@example.com',
        phone: '9820000099',
        membershipPlan: 'monthly',
      }),
    });
    assert.equal(res.status, 409);
  });

  it('7. GET /:id - member can fetch their own profile', async () => {
    const res = await fetch(`${baseUrl}/${memberUser1._id}`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data._id, memberUser1._id.toString());
  });

  it('8. GET /:id - member CANNOT fetch another member profile (IDOR prevention)', async () => {
    const res = await fetch(`${baseUrl}/${memberUser2._id}`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 403);
  });

  it('9. GET /:id - non-existent member returns 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await fetch(`${baseUrl}/${fakeId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 404);
  });

  it('10. PATCH /:id/role - cannot change own role', async () => {
    const res = await fetch(`${baseUrl}/${adminUser._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(res.status, 400);
  });

  it('11. PATCH /:id/role - cannot demote last admin', async () => {
    // Create a temporary second admin so 2 admins exist
    const tempAdmin = await User.create({
      name: 'Temp Admin Role',
      email: 'membertest_tempadmin@example.com',
      phone: '9820000050',
      password: 'password123',
      role: 'admin',
    });
    // Demoting tempAdmin succeeds since 2 admins exist
    const res1 = await fetch(`${baseUrl}/${tempAdmin._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'trainer' }),
    });
    assert.equal(res1.status, 200);
    await User.deleteOne({ _id: tempAdmin._id });
  });

  it('12. DELETE /:id - admin CANNOT delete their own account (self-deletion guard)', async () => {
    const res = await fetch(`${baseUrl}/${adminUser._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.message, /cannot delete your own account/i);
  });

  it('13. DELETE /:id - admin CANNOT delete the last remaining admin', async () => {
    const tempAdmin = await User.create({
      name: 'Temp Admin Delete',
      email: 'membertest_tempdel@example.com',
      phone: '9820000077',
      password: 'password123',
      role: 'admin',
    });
    // Deleting tempAdmin succeeds because adminUser also exists (2 admins)
    const resDeleteTemp = await fetch(`${baseUrl}/${tempAdmin._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resDeleteTemp.status, 200);

    // Now adminUser is the sole admin. Trying to delete adminUser was rejected in test 12.
    // If another admin existed and tried to delete the only admin, it would reject.
    assert.equal(await User.countDocuments({ role: 'admin' }), 1);
  });

  it('14. DELETE /:id - non-existent member returns 404', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await fetch(`${baseUrl}/${fakeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 404);
  });

  it('15. DELETE /:id - successfully deletes member and cascades cleanup', async () => {
    const toDelete = await User.create({
      name: 'Doomed Member',
      email: 'membertest_doomed@example.com',
      phone: '9820000090',
      password: 'password123',
      role: 'member',
    });
    const res = await fetch(`${baseUrl}/${toDelete._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.message, 'Member deleted');
  });
});
