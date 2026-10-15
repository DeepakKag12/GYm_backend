const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { setupTestDb, teardownTestDb } = require('../test_helper');
const { notifyMember, notifyAdmin, adminWhatsAppNumber } = require('../../src/services/notify');
const { formatWhatsAppNumber, whatsappStatus } = require('../../src/utils/whatsapp');
const { emailStatus } = require('../../src/utils/email');
const User = require('../../src/models/User.model');
const Notification = require('../../src/models/Notification.model');
const whatsapp = require('../../src/utils/whatsapp');
const email = require('../../src/utils/email');

describe('Unit Test: Notifications Dispatcher & Outbound Resilience (notify, whatsapp, email)', () => {
  let member;

  before(async () => {
    await setupTestDb();
    await User.deleteMany({ email: /^unit_notif_/ });

    member = await User.create({
      name: 'Unit Notif Member',
      email: 'unit_notif_member@example.com',
      phone: '9876549901',
      password: 'password123',
      role: 'member',
    });
  });

  after(async () => {
    await Notification.deleteMany({ member: member?._id });
    await User.deleteMany({ email: /^unit_notif_/ });
    await teardownTestDb();
  });

  // 1. WhatsApp Number Formatting
  test('1. formatWhatsAppNumber formats 10-digit, trunk-0, and +91 into E.164 digits', () => {
    assert.equal(formatWhatsAppNumber('9876549901'), '919876549901');
    assert.equal(formatWhatsAppNumber('+91 98765 49901'), '919876549901');
    assert.equal(formatWhatsAppNumber('09876549901'), '919876549901');
    assert.equal(formatWhatsAppNumber('00919876549901'), '919876549901');
    assert.equal(formatWhatsAppNumber(''), null);
    assert.equal(formatWhatsAppNumber(null), null);
  });

  // 2. Service Config Status Checks
  test('2. whatsappStatus and emailStatus return valid diagnostic descriptors', () => {
    const wa = whatsappStatus();
    assert.ok(typeof wa.ok === 'boolean');

    const em = emailStatus();
    assert.ok(typeof em.ok === 'boolean');
  });

  // 3. Outbound Failure Isolation (Never crashes or aborts in-app creation)
  test('3. notifyMember creates in-app notification even if WhatsApp throws or fails', async () => {
    // Temporarily mock sendWhatsApp to simulate network crash
    const originalSendWA = whatsapp.sendWhatsApp;
    whatsapp.sendWhatsApp = async () => {
      throw new Error('Meta API connection reset by peer');
    };

    let threw = false;
    let res = null;
    try {
      res = await notifyMember(member, {
        type: 'fee-reminder',
        title: 'Fee Reminder Crash Test',
        message: 'Your fee is due today.',
        channels: ['website', 'whatsapp', 'email'],
      });
    } catch (e) {
      threw = true;
    } finally {
      whatsapp.sendWhatsApp = originalSendWA;
    }

    assert.equal(threw, false, 'notifyMember must NEVER throw when an outbound channel crashes');
    assert.ok(res?.notification, 'In-app notification document must still be created');
    assert.equal(res.notification.title, 'Fee Reminder Crash Test');
    assert.ok(res.failed.includes('whatsapp'), 'Failed list must record whatsapp failure');
    if (res.notification.delivery?.whatsapp) {
      assert.equal(res.notification.delivery.whatsapp.status, 'failed');
    }
  });

  test('4. notifyAdmin handles empty or unconfigured admin number gracefully', async () => {
    const res = await notifyAdmin({
      title: 'Admin Alert',
      message: 'New member registered',
    });
    // Resolves cleanly without throwing
    assert.ok(res !== undefined);
  });
});
