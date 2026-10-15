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
const Notification = require('../src/models/Notification.model');

describe('Notifications Routes & Controller (/api/notifications)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let memberUser1, memberToken1;
  let memberUser2, memberToken2;
  let notifMember1;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^notiftest_/ });

    adminUser = await User.create({
      name: 'Notif Admin',
      email: 'notiftest_admin@example.com',
      phone: '9876543801',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser1 = await User.create({
      name: 'Notif Member 1',
      email: 'notiftest_member1@example.com',
      phone: '9876543802',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      feePaid: true,
    });
    memberToken1 = makeToken(memberUser1);

    memberUser2 = await User.create({
      name: 'Notif Member 2',
      email: 'notiftest_member2@example.com',
      phone: '9876543803',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStatus: 'active',
      feePaid: true,
    });
    memberToken2 = makeToken(memberUser2);

    notifMember1 = await Notification.create({
      member: memberUser1._id,
      type: 'announcement',
      title: 'Welcome to FitNation',
      message: 'Your fitness journey starts now!',
      isRead: false,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/notifications`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^notiftest_/ });
    await Notification.deleteMany({ member: { $in: [memberUser1?._id, memberUser2?._id, adminUser?._id] } });
    await teardownTestDb();
  });

  // 1. GET /api/notifications (User's own notifications & IDOR check)
  test('1. Member can fetch their own notifications, Member 2 does not see Member 1 notifications', async () => {
    const res1 = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res1.status, 200);
    const list1 = await res1.json();
    assert.ok(Array.isArray(list1));
    const found = list1.find((n) => n._id.toString() === notifMember1._id.toString());
    assert.ok(found);

    const res2 = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res2.status, 200);
    const list2 = await res2.json();
    assert.ok(Array.isArray(list2));
    const leak = list2.find((n) => n._id.toString() === notifMember1._id.toString());
    assert.equal(leak, undefined, 'IDOR: Member 2 must not see Member 1 notification');
  });

  // 2. Admin routes: getAllNotificationsAdmin, markAllReadAdmin, getChannelHealth
  test('2. Admin can fetch all notifications and check channel health', async () => {
    const resAll = await fetch(`${baseUrl}/admin/all`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAll.status, 200);
    const all = await resAll.json();
    assert.ok(Array.isArray(all));

    const resHealth = await fetch(`${baseUrl}/admin/channels`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resHealth.status, 200);
    const health = await resHealth.json();
    assert.ok(typeof health === 'object');
  });

  test('3. Non-admin is blocked with 403 on admin notification endpoints', async () => {
    const res1 = await fetch(`${baseUrl}/admin/all`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res1.status, 403);

    const res2 = await fetch(`${baseUrl}/admin/channels`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res2.status, 403);
  });

  // 3. POST /api/notifications/admin/send (direct and broadcast)
  test('4. Admin can send direct notification to specific member', async () => {
    const res = await fetch(`${baseUrl}/admin/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        memberId: memberUser2._id.toString(),
        title: 'Personal Training Offer',
        message: 'Get 20% off PT sessions this week!',
        channels: ['website'],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.title, 'Personal Training Offer');

    const created = await Notification.findOne({ member: memberUser2._id, title: 'Personal Training Offer' });
    assert.ok(created);
  });

  test('5. Admin can broadcast notification to members', async () => {
    const res = await fetch(`${baseUrl}/admin/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Gym Holiday Notice',
        message: 'Gym will close at 8 PM on festival day.',
        channels: ['website'],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.sent >= 1);
  });

  // 4. PUT /api/notifications/:id/read (single read with IDOR protection)
  test('6. Member 2 cannot mark Member 1 notification as read (IDOR defense)', async () => {
    const res = await fetch(`${baseUrl}/${notifMember1._id}/read`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res.status, 404); // Not found for this member
  });

  test('7. Member 1 can mark their own notification as read', async () => {
    const res = await fetch(`${baseUrl}/${notifMember1._id}/read`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.isRead, true);
  });

  // 5. PUT /api/notifications/read-all
  test('8. Member can mark all their notifications as read', async () => {
    const res = await fetch(`${baseUrl}/read-all`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.message, /marked as read/i);
  });

  // 6. Admin deletion
  test('9. Admin can delete notification and clear bulk with filter', async () => {
    const tempNotif = await Notification.create({
      member: memberUser1._id,
      type: 'announcement',
      title: 'Temp Notif',
      message: 'Temporary message to delete',
      isRead: false,
    });

    const resDelOne = await fetch(`${baseUrl}/admin/${tempNotif._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resDelOne.status, 200);

    const checkOne = await Notification.findById(tempNotif._id);
    assert.equal(checkOne, null);

    // Bulk clear without filter gives 400
    const resNoFilter = await fetch(`${baseUrl}/admin`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resNoFilter.status, 400);

    // Bulk clear with member filter
    const resFiltered = await fetch(`${baseUrl}/admin?member=${memberUser1._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resFiltered.status, 200);
    const data = await resFiltered.json();
    assert.equal(typeof data.deletedCount, 'number');
  });
});
