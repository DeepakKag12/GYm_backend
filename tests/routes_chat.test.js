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
const { Message } = require('../src/models/Message.model');

describe('Chat Routes & Controller (/api/chat)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let trainerUser, trainerToken;
  let memberUser1, memberToken1;
  let memberUser2, memberToken2;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^chattest_/ });
    await Message.deleteMany({});

    adminUser = await User.create({
      name: 'Chat Admin',
      email: 'chattest_admin@example.com',
      phone: '9876544501',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    trainerUser = await User.create({
      name: 'Chat Trainer',
      email: 'chattest_trainer@example.com',
      phone: '9876544502',
      password: 'password123',
      role: 'trainer',
    });
    trainerToken = makeToken(trainerUser);

    memberUser1 = await User.create({
      name: 'Chat Member 1',
      email: 'chattest_member1@example.com',
      phone: '9876544503',
      password: 'password123',
      role: 'member',
    });
    memberToken1 = makeToken(memberUser1);

    memberUser2 = await User.create({
      name: 'Chat Member 2',
      email: 'chattest_member2@example.com',
      phone: '9876544504',
      password: 'password123',
      role: 'member',
    });
    memberToken2 = makeToken(memberUser2);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/chat`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^chattest_/ });
    await Message.deleteMany({});
    await teardownTestDb();
  });

  // 1. GET /api/chat/contacts (Role-based access)
  test('1. Member contacts list only includes staff (admin/trainer), not other members', async () => {
    const res = await fetch(`${baseUrl}/contacts`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res.status, 200);
    const contacts = await res.json();
    assert.ok(Array.isArray(contacts));
    const hasAdmin = contacts.some((c) => c._id.toString() === adminUser._id.toString());
    const hasTrainer = contacts.some((c) => c._id.toString() === trainerUser._id.toString());
    const hasOtherMember = contacts.some((c) => c._id.toString() === memberUser2._id.toString());
    assert.ok(hasAdmin, 'Member must be able to contact admin');
    assert.ok(hasTrainer, 'Member must be able to contact trainer');
    assert.equal(hasOtherMember, false, 'Member must not see or contact other members');
  });

  test('2. Trainer contacts list includes admins, other trainers, and members', async () => {
    const res = await fetch(`${baseUrl}/contacts`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(res.status, 200);
    const contacts = await res.json();
    assert.ok(Array.isArray(contacts));
    assert.ok(contacts.some((c) => c._id.toString() === adminUser._id.toString()));
    assert.ok(contacts.some((c) => c._id.toString() === memberUser1._id.toString()));
    assert.ok(contacts.some((c) => c._id.toString() === memberUser2._id.toString()));
  });

  // 2. POST /api/chat/messages (Send message)
  test('3. Send message validates recipient and message text', async () => {
    const resNoText = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({ recipientId: trainerUser._id.toString(), text: '   ' }),
    });
    assert.equal(resNoText.status, 400);

    const nonId = new mongoose.Types.ObjectId();
    const resGhost = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({ recipientId: nonId.toString(), text: 'Hello ghost' }),
    });
    assert.equal(resGhost.status, 404);

    const resSend = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({
        recipientId: trainerUser._id.toString(),
        text: 'Coach, need help with bench form.',
      }),
    });
    assert.equal(resSend.status, 201);
    const message = await resSend.json();
    assert.equal(message.text, 'Coach, need help with bench form.');
    assert.equal(message.sender._id.toString(), memberUser1._id.toString());
    assert.equal(message.recipient._id.toString(), trainerUser._id.toString());
    assert.equal(message.isRead, false);
  });

  // 3. GET /api/chat/unread-count and GET /api/chat/conversations
  test('4. Trainer has unread messages and sees active conversation', async () => {
    const resCount = await fetch(`${baseUrl}/unread-count`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resCount.status, 200);
    const countData = await resCount.json();
    assert.equal(countData.unreadCount, 1);

    const resConvs = await fetch(`${baseUrl}/conversations`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resConvs.status, 200);
    const convs = await resConvs.json();
    assert.ok(Array.isArray(convs));
    assert.equal(convs.length, 1);
    assert.equal(convs[0].participant._id.toString(), memberUser1._id.toString());
    assert.equal(convs[0].unreadCount, 1);
    assert.equal(convs[0].lastMessage.text, 'Coach, need help with bench form.');
  });

  // 4. GET /api/chat/messages/:userId & mark as read
  test('5. Trainer fetches messages which automatically marks them as read', async () => {
    const resGet = await fetch(`${baseUrl}/messages/${memberUser1._id}`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resGet.status, 200);
    const messages = await resGet.json();
    assert.ok(Array.isArray(messages));
    assert.equal(messages.length, 1);

    // After fetch, unread count for trainer should now be 0
    const resCountAfter = await fetch(`${baseUrl}/unread-count`, {
      headers: { Authorization: `Bearer ${trainerToken}` },
    });
    assert.equal(resCountAfter.status, 200);
    const countDataAfter = await resCountAfter.json();
    assert.equal(countDataAfter.unreadCount, 0);
  });

  // 5. PUT /api/chat/read/:userId explicitly marks messages as read
  test('6. Explicit PUT /api/chat/read/:userId marks messages as read', async () => {
    // Trainer sends message to member 1
    await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        recipientId: memberUser1._id.toString(),
        text: 'Sure, send a video of your set.',
      }),
    });

    const resMark = await fetch(`${baseUrl}/read/${trainerUser._id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resMark.status, 200);
    const data = await resMark.json();
    assert.equal(data.success, true);

    const resMemberCount = await fetch(`${baseUrl}/unread-count`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    const memCount = await resMemberCount.json();
    assert.equal(memCount.unreadCount, 0);
  });
});
