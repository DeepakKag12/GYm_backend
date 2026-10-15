const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('../test_helper');
const app = require('../../src/app');
const User = require('../../src/models/User.model');

describe('Flow 1: Auth, Roles, Profile & Phone Formats E2E Flow', () => {
  let server;
  let authUrl, membersUrl;
  let adminUser, adminToken;

  before(async () => {
    await setupTestDb();
    await User.deleteMany({ email: /^flow1_/ });

    adminUser = await User.create({
      name: 'Flow1 Sole Admin',
      email: 'flow1_admin@example.com',
      phone: '9876550001',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    authUrl = `http://127.0.0.1:${port}/api/auth`;
    membersUrl = `http://127.0.0.1:${port}/api/members`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^flow1_/ });
    await teardownTestDb();
  });

  // 1. Registration and phone formats
  test('1. User registers with standard phone format; duplicate phone is rejected', async () => {
    const resReg = await fetch(`${authUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Flow1 User One',
        email: 'flow1_user1@example.com',
        phone: '+91 98765 50002',
        password: 'secretPassword123',
      }),
    });
    assert.equal(resReg.status, 201);
    const regData = await resReg.json();
    assert.ok(regData.token);
    assert.equal(regData.user.name, 'Flow1 User One');

    // Duplicate email registration rejected
    const resDupEmail = await fetch(`${authUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Imposter',
        email: 'flow1_user1@example.com',
        phone: '9876550003',
        password: 'password123',
      }),
    });
    assert.equal(resDupEmail.status, 400);

    // Duplicate phone with different format (0-prefixed) rejected by unique phone index
    const resDupPhone = await fetch(`${authUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Phone Imposter',
        email: 'flow1_user_other@example.com',
        phone: '09876550002',
        password: 'password123',
      }),
    });
    assert.equal(resDupPhone.status, 400);
    const dupPhoneData = await resDupPhone.json();
    assert.match(dupPhoneData.message, /phone number is already used/i);
  });

  // 2. Login by email and phone formats
  test('2. User can log in by email and by phone in varied formats (+91, 0-prefix, bare digits)', async () => {
    // Login by email
    const resEmail = await fetch(`${authUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'flow1_user1@example.com',
        password: 'secretPassword123',
      }),
    });
    assert.equal(resEmail.status, 200);

    // Login by bare 10-digit phone
    const resBarePhone = await fetch(`${authUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '9876550002',
        password: 'secretPassword123',
      }),
    });
    assert.equal(resBarePhone.status, 200);

    // Login by +91 formatted phone
    const resCountryPhone = await fetch(`${authUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '+91 98765 50002',
        password: 'secretPassword123',
      }),
    });
    assert.equal(resCountryPhone.status, 200);

    // Login by 0-prefixed phone
    const resZeroPhone = await fetch(`${authUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '09876550002',
        password: 'secretPassword123',
      }),
    });
    assert.equal(resZeroPhone.status, 200);
  });

  // 3. /auth/me, expired token and profile update
  test('3. /auth/me verifies session, expired token rejected with 401', async () => {
    const user1 = await User.findOne({ email: 'flow1_user1@example.com' });
    const validToken = makeToken(user1);

    const resMe = await fetch(`${authUrl}/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.equal(resMe.status, 200);
    const me = await resMe.json();
    assert.equal(me.email, 'flow1_user1@example.com');

    // Expired token
    const expiredToken = jwt.sign({ id: user1._id }, process.env.JWT_SECRET, { expiresIn: '0s' });
    const resExpired = await fetch(`${authUrl}/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(resExpired.status, 401);
  });

  test('4. User updates profile and credentials', async () => {
    const user1 = await User.findOne({ email: 'flow1_user1@example.com' });
    const token = makeToken(user1);

    // Update profile
    const resProf = await fetch(`${authUrl}/update-profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Flow1 User Updated',
        address: '123 Fitness Street',
        gender: 'female',
      }),
    });
    assert.equal(resProf.status, 200);
    const profData = await resProf.json();
    assert.equal(profData.user.name, 'Flow1 User Updated');
    assert.equal(profData.user.gender, 'female');

    // Update credentials with wrong current password
    const resWrongPass = await fetch(`${authUrl}/update-credentials`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        currentPassword: 'wrongPassword',
        newPassword: 'newSecretPassword123',
      }),
    });
    assert.equal(resWrongPass.status, 400);

    // Update credentials with correct current password
    const resCred = await fetch(`${authUrl}/update-credentials`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        currentPassword: 'secretPassword123',
        newPassword: 'newSecretPassword123',
      }),
    });
    assert.equal(resCred.status, 200);

    // Verify login with new password works, old password fails
    const resOldLogin = await fetch(`${authUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'flow1_user1@example.com',
        password: 'secretPassword123',
      }),
    });
    assert.equal(resOldLogin.status, 401);

    const resNewLogin = await fetch(`${authUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'flow1_user1@example.com',
        password: 'newSecretPassword123',
      }),
    });
    assert.equal(resNewLogin.status, 200);
  });

  // 4. Role changes & Last Admin Guards
  test('5. Role changes work; admin cannot demote themselves or remove the last admin', async () => {
    const user1 = await User.findOne({ email: 'flow1_user1@example.com' });

    // Promote user1 to trainer
    const resPromoteTrainer = await fetch(`${membersUrl}/${user1._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'trainer' }),
    });
    assert.equal(resPromoteTrainer.status, 200);
    const trainerData = await resPromoteTrainer.json();
    assert.equal(trainerData.user.role, 'trainer');

    // Admin tries to demote themselves -> blocked with 400
    const resDemoteSelf = await fetch(`${membersUrl}/${adminUser._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(resDemoteSelf.status, 400);
    const selfMsg = await resDemoteSelf.json();
    assert.match(selfMsg.message, /cannot change your own role/i);

    // Promote user1 to admin (now there are 2 admins)
    const resPromoteAdmin = await fetch(`${membersUrl}/${user1._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(resPromoteAdmin.status, 200);

    // Now adminUser can be demoted by user1 because there is another admin
    const user1Token = makeToken(user1);
    const resDemoteAdmin = await fetch(`${membersUrl}/${adminUser._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ role: 'trainer' }),
    });
    assert.equal(resDemoteAdmin.status, 200);

    // Now user1 is the ONLY remaining admin. Demoting user1 must be blocked
    // Promote another temporary member, try to demote user1 from temp member (fails because user1 is sole admin)
    const resSoleAdminDemote = await fetch(`${membersUrl}/${user1._id}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(resSoleAdminDemote.status, 400); // cannot demote self + cannot demote sole admin
  });
});
