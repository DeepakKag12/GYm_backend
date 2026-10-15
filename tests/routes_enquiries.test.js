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
const Enquiry = require('../src/models/Enquiry.model');

describe('Enquiries Routes & Controller (/api/enquiries)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let memberUser, memberToken;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^enqtest_/ });
    await Enquiry.deleteMany({});

    adminUser = await User.create({
      name: 'Enquiry Admin',
      email: 'enqtest_admin@example.com',
      phone: '9876543501',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'Enquiry Member',
      email: 'enqtest_member@example.com',
      phone: '9876543502',
      password: 'password123',
      role: 'member',
    });
    memberToken = makeToken(memberUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/enquiries`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^enqtest_/ });
    await Enquiry.deleteMany({});
    await teardownTestDb();
  });

  // 1. POST /api/enquiries (public submission & phone formatting)
  test('1. createEnquiry rejects empty required fields with 400', async () => {
    const resNoName = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543503', message: 'Hello' }),
    });
    assert.equal(resNoName.status, 400);

    const resNoPhone = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rahul', message: 'Hello' }),
    });
    assert.equal(resNoPhone.status, 400);

    const resNoMsg = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rahul', phone: '9876543503' }),
    });
    assert.equal(resNoMsg.status, 400);
  });

  test('2. createEnquiry accepts standard 10-digit phone', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Amit Patel',
        phone: '9876543510',
        message: 'Interested in gym membership',
        email: 'amit@example.com',
        interest: 'membership',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.enquiry.phone, '9876543510');
  });

  test('3. createEnquiry accepts phone with +91 country code and leading 0', async () => {
    // Test +91 formatted phone
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Vikas Sharma',
        phone: '+91 98765 43511',
        message: 'Personal training inquiry',
        interest: 'personal-training',
      }),
    });
    assert.equal(res1.status, 201, 'Expected 201 when phone has +91 prefix');
    const data1 = await res1.json();
    assert.equal(data1.enquiry.phone, '9876543511');

    // Test 0-prefixed phone
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pooja Singh',
        phone: '09876543512',
        message: 'Diet plan inquiry',
        interest: 'diet-plan',
      }),
    });
    assert.equal(res2.status, 201, 'Expected 201 when phone has 0 prefix');
    const data2 = await res2.json();
    assert.equal(data2.enquiry.phone, '9876543512');
  });

  // 2. GET /api/enquiries (RBAC & pagination)
  test('4. Non-admin is blocked with 403 on GET /api/enquiries', async () => {
    const res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('5. Admin can fetch all enquiries with pagination headers', async () => {
    const res = await fetch(`${baseUrl}?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('x-total-count'));
    assert.equal(res.headers.get('x-page'), '1');
    const list = await res.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);
  });

  // 3. PUT /api/enquiries/:id
  test('6. Admin can update enquiry status and notes', async () => {
    const enq = await Enquiry.findOne({ name: 'Amit Patel' });
    assert.ok(enq);

    const res = await fetch(`${baseUrl}/${enq._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'contacted',
        notes: 'Called and discussed membership options',
      }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.status, 'contacted');
    assert.equal(updated.notes, 'Called and discussed membership options');
  });

  // 4. POST /api/enquiries/:id/reply
  test('7. Admin can reply to enquiry, sends email and generates WhatsApp URL', async () => {
    const enq = await Enquiry.findOne({ name: 'Amit Patel' });
    assert.ok(enq);

    const res = await fetch(`${baseUrl}/${enq._id}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        message: 'Thank you for reaching out! We offer gold and platinum plans.',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.whatsappUrl);
    assert.match(data.whatsappUrl, /wa\.me\/919876543510/);
    assert.ok(data.emailSent);
  });

  // 5. DELETE /api/enquiries/:id
  test('8. Admin can delete enquiry, non-admin blocked with 403', async () => {
    const enq = await Enquiry.findOne({ name: 'Amit Patel' });
    assert.ok(enq);

    const resNonAdmin = await fetch(`${baseUrl}/${enq._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resNonAdmin.status, 403);

    const resAdmin = await fetch(`${baseUrl}/${enq._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);

    const check = await Enquiry.findById(enq._id);
    assert.equal(check, null);
  });
});
