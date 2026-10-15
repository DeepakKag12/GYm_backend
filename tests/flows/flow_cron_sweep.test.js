const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  setupTestDb,
  teardownTestDb,
} = require('../test_helper');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Notification = require('../../src/models/Notification.model');
const { localDate } = require('../../src/utils/dateUtils');
const { runFeeReminderSweep } = require('../../src/services/feeReminder');

describe('Flow 6: Fee Reminder Sweep & Vercel Cron E2E Flow', () => {
  let server;
  let cronUrl;
  const cronSecret = 'test-cron-secret-12345';
  let origCronSecret;

  before(async () => {
    origCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = cronSecret;

    await setupTestDb();

    // Clean up only Flow 6 records
    const users = await User.find({ email: /^flow6_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Notification.deleteMany({ member: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    cronUrl = `http://127.0.0.1:${port}/api/cron/fee-reminder`;
  });

  after(async () => {
    process.env.CRON_SECRET = origCronSecret;
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    const users = await User.find({ email: /^flow6_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Notification.deleteMany({ member: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }

    await teardownTestDb();
  });

  // 1. Authorization & CRON_SECRET guards
  test('1. Cron route requires CRON_SECRET Bearer token; rejects 401 if missing or wrong', async () => {
    // Missing auth header
    const resNoAuth = await fetch(cronUrl);
    assert.equal(resNoAuth.status, 401);

    // Wrong token
    const resBadAuth = await fetch(cronUrl, {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    assert.equal(resBadAuth.status, 401);

    // Correct secret
    const resOk = await fetch(cronUrl, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(resOk.status, 200);
    const body = await resOk.json();
    assert.equal(body.ok, true);
  });

  test('2. Missing CRON_SECRET on server responds with 503 Service Unavailable', async () => {
    delete process.env.CRON_SECRET;
    const res = await fetch(cronUrl, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.message, /CRON_SECRET is not configured/i);

    // Restore secret
    process.env.CRON_SECRET = cronSecret;
  });

  // 2. Reminder sweep milestones and boundary conditions
  test('3. runFeeReminderSweep triggers WhatsApp milestones and flips expired member status', async () => {
    const today = new Date();

    // Member 1: Expires in 2 days (WhatsApp milestone: reminderSentWA2days)
    const in2Days = new Date(today);
    in2Days.setDate(in2Days.getDate() + 2);

    const m2Days = await User.create({
      name: 'Flow6 In Two Days',
      email: 'flow6_2days@example.com',
      phone: '9876546001',
      password: 'password123',
      role: 'member',
      membershipStatus: 'active',
      membershipEnd: in2Days,
      feePaid: true,
    });

    // Member 2: Expires today (WhatsApp milestone: reminderSentWAExpiry)
    const mToday = await User.create({
      name: 'Flow6 Expires Today',
      email: 'flow6_today@example.com',
      phone: '9876546002',
      password: 'password123',
      role: 'member',
      membershipStatus: 'active',
      membershipEnd: today,
      feePaid: true,
    });

    // Member 3: Expired yesterday (1 day ago) (WhatsApp milestone: reminderSentWA1dayAfter, flips to expired)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const mYesterday = await User.create({
      name: 'Flow6 Expired Yesterday',
      email: 'flow6_yesterday@example.com',
      phone: '9876546003',
      password: 'password123',
      role: 'member',
      membershipStatus: 'active', // starts active, should be flipped to expired
      membershipEnd: yesterday,
      feePaid: true,
    });

    // Member 4: Expired 5 days ago (beyond 3-day grace period; should NOT be notified)
    const fiveDaysAgo = new Date(today);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const mOld = await User.create({
      name: 'Flow6 Expired Long Ago',
      email: 'flow6_old@example.com',
      phone: '9876546004',
      password: 'password123',
      role: 'member',
      membershipStatus: 'expired',
      membershipEnd: fiveDaysAgo,
      feePaid: false,
    });

    // Run sweep for slot 'am'
    const sweepResult = await runFeeReminderSweep({ slot: 'am' });
    assert.ok(sweepResult.notified >= 3, 'Must notify at least the 3 eligible members');

    // Verify Member 1: reminderSentWA2days flag set
    const check1 = await User.findById(m2Days._id);
    assert.equal(check1.reminderSentWA2days, true);
    assert.match(check1.lastReminderSlot, /-am$/);

    // Verify Member 2: reminderSentWAExpiry flag set
    const check2 = await User.findById(mToday._id);
    assert.equal(check2.reminderSentWAExpiry, true);

    // Verify Member 3: reminderSentWA1dayAfter flag set AND status flipped to 'expired'
    const check3 = await User.findById(mYesterday._id);
    assert.equal(check3.reminderSentWA1dayAfter, true);
    assert.equal(check3.membershipStatus, 'expired', 'Expired member must have membershipStatus updated to expired');

    // Verify Member 4: Not notified (beyond grace window)
    const check4 = await User.findById(mOld._id);
    assert.ok(!check4.lastReminderSlot, 'Old expired member must not receive slot reminder');
  });

  // 3. Slot Idempotency
  test('4. Slot idempotency: re-running sweep in the same slot skips already notified members', async () => {
    // Re-run in slot 'am'
    const reSweepAm = await runFeeReminderSweep({ slot: 'am' });

    // Since our Flow6 members already have lastReminderSlot ending in -am,
    // they should not be re-notified in the same slot.
    const flow6Users = await User.find({ email: /^flow6_/ }).select('_id');
    const flow6Ids = flow6Users.map((u) => u._id);

    // Count in-app notifications created during this second run
    const notifs = await Notification.find({
      member: { $in: flow6Ids },
      title: /membership/i,
    });
    // Total notifications should remain 3 (one per member), not double
    assert.equal(notifs.length, 3, 'Second sweep in same slot must not produce duplicate notifications');
  });

  // 4. Resilience to missing/failing outbound delivery
  test('5. Sweep does not crash or abort when a member has failing outbound delivery', async () => {
    const today = new Date();
    const brokenMember = await User.create({
      name: 'Flow6 Broken Contact',
      email: 'flow6_broken@example.com',
      phone: '9876546009',
      password: 'password123',
      role: 'member',
      membershipStatus: 'active',
      membershipEnd: today,
    });

    const result = await runFeeReminderSweep({ slot: 'pm' });
    assert.ok(result);
    assert.equal(result.failed, 0, 'Sweep must succeed without throwing');
  });
});
