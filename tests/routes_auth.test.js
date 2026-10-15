const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { setupTestDb, teardownTestDb, makeToken } = require('./test_helper');
const app = require('../src/app');
const User = require('../src/models/User.model');

describe('Auth Routes Test Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    await setupTestDb();
    await User.deleteMany({ email: /^authtest_/ });
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
        resolve();
      });
    });
  });

  after(async () => {
    await User.deleteMany({ email: /^authtest_/ });
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await teardownTestDb();
  });

  it('1. POST /register - successfully registers a new member', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Auth Test Member',
        email: 'authtest_member@example.com',
        phone: '9811111110',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.token);
    assert.equal(data.user.email, 'authtest_member@example.com');
    assert.equal(data.user.password, undefined);
  });

  it('2. POST /register - rejects missing required fields', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Incomplete' }),
    });
    assert.equal(res.status, 400);
  });

  it('3. POST /register - rejects short password (< 6 chars)', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Short Pass',
        email: 'authtest_shortpass@example.com',
        phone: '9811111111',
        password: '123',
      }),
    });
    assert.equal(res.status, 400);
  });

  it('4. POST /register - rejects duplicate email', async () => {
    const res = await fetch(`${baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Email',
        email: 'authtest_member@example.com',
        phone: '9811111112',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 400);
  });

  it('5. POST /login - succeeds with email and correct password', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'authtest_member@example.com',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
    assert.equal(data.user.email, 'authtest_member@example.com');
  });

  it('6. POST /login - succeeds with 10-digit phone', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '9811111110',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
  });

  it('7. POST /login - succeeds with formatted phone "+91 98111 11110"', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '+91 98111 11110',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
  });

  it('8. POST /login - succeeds with 11-digit leading-zero phone "09811111110"', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '09811111110',
        password: 'password123',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
  });

  it('9. POST /login - rejects incorrect password', async () => {
    const res = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'authtest_member@example.com',
        password: 'wrongpassword',
      }),
    });
    assert.equal(res.status, 401);
  });

  it('10. GET /me - rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/me`);
    assert.equal(res.status, 401);
  });

  it('11. GET /me - returns user profile when authenticated', async () => {
    const user = await User.findOne({ email: 'authtest_member@example.com' });
    assert.ok(user, 'User authtest_member@example.com should exist');
    const token = makeToken(user);
    const res = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.email, 'authtest_member@example.com');
  });

  it('12. PUT /update-profile - updates address and gender', async () => {
    const user = await User.findOne({ email: 'authtest_member@example.com' });
    const token = makeToken(user);
    const res = await fetch(`${baseUrl}/update-profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ address: '123 Gym Street', gender: 'male' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.address, '123 Gym Street');
    assert.equal(data.user.gender, 'male');
  });

  it('13. PUT /update-credentials - updates password with valid current password', async () => {
    const user = await User.findOne({ email: 'authtest_member@example.com' });
    const token = makeToken(user);
    const res = await fetch(`${baseUrl}/update-credentials`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'newpassword456',
      }),
    });
    assert.equal(res.status, 200);

    // Verify login with new password succeeds
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'authtest_member@example.com',
        password: 'newpassword456',
      }),
    });
    assert.equal(loginRes.status, 200);
  });
});
