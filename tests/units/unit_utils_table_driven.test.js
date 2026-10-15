const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { canonicalPhone } = require('../../src/utils/phone');
const { calcExpiry, daysRemaining, localDate } = require('../../src/utils/dateUtils');
const { describeDbError } = require('../../src/utils/dbError');
const { findDuplicate, normaliseEmail, normalisePhone } = require('../../src/utils/duplicateUser');
const User = require('../../src/models/User.model');
const { setupTestDb, teardownTestDb } = require('../test_helper');

describe('Unit Test: Table-Driven Utilities (phone, dateUtils, dbError, duplicateUser)', () => {
  // 1. Table-Driven Phone Normalization
  test('1. canonicalPhone table-driven test matrix', () => {
    const cases = [
      { input: '9876543210', expected: '9876543210' },
      { input: '+91 98765 43210', expected: '9876543210' },
      { input: '+919876543210', expected: '9876543210' },
      { input: '09876543210', expected: '9876543210' },
      { input: '00919876543210', expected: '9876543210' },
      { input: '+91-98765-43210', expected: '9876543210' },
      { input: '+91 (98765) 43210', expected: '9876543210' },
      { input: '98765-43210', expected: '9876543210' },
      { input: '  9876543210  ', expected: '9876543210' },
      { input: '', expected: '' },
      { input: null, expected: '' },
      { input: undefined, expected: '' },
      { input: '12345', expected: '12345' }, // Raw digits preserved for short codes
      { input: 'abcdefghij', expected: '' }, // Letters only stripped to empty
      { input: '+919876543210', expected: '9876543210' },
    ];

    for (const c of cases) {
      assert.equal(canonicalPhone(c.input), c.expected, `Failed for input: ${c.input}`);
    }
  });

  // 2. Table-Driven Date Arithmetic & Month Clamping
  test('2. calcExpiry & daysRemaining table-driven date matrix', () => {
    // Leap year Jan 31 -> Feb 29
    const d2024 = calcExpiry('2024-01-31', 'monthly');
    assert.equal(localDate(d2024), '2024-02-29');

    // Non-leap year Jan 31 -> Feb 28
    const d2025 = calcExpiry('2025-01-31', 'monthly');
    assert.equal(localDate(d2025), '2025-02-28');

    // Quarterly from Jan 31 -> Apr 30
    const dQuarter = calcExpiry('2026-01-31', 'quarterly');
    assert.equal(localDate(dQuarter), '2026-04-30');

    // Half-yearly from Jan 31 -> Jul 31
    const dHalf = calcExpiry('2026-01-31', 'half-yearly');
    assert.equal(localDate(dHalf), '2026-07-31');

    // Yearly from Jan 31 -> Jan 31
    const dYear = calcExpiry('2026-01-31', 'yearly');
    assert.equal(localDate(dYear), '2027-01-31');

    // Month rollovers for 30-day months
    assert.equal(localDate(calcExpiry('2026-03-31', 'monthly')), '2026-04-30');
    assert.equal(localDate(calcExpiry('2026-05-31', 'monthly')), '2026-06-30');
    assert.equal(localDate(calcExpiry('2026-08-31', 'monthly')), '2026-09-30');
    assert.equal(localDate(calcExpiry('2026-10-31', 'monthly')), '2026-11-30');

    // Invalid dates / plans
    assert.equal(calcExpiry(null, 'monthly'), null);
    assert.equal(calcExpiry('invalid-date', 'monthly'), null);
    assert.equal(calcExpiry('2026-01-01', null), null);

    // daysRemaining
    const now = new Date('2026-05-15T12:00:00+05:30');
    assert.equal(daysRemaining('2026-05-15', now), 0); // Today
    assert.equal(daysRemaining('2026-05-18', now), 3); // 3 days in future
    assert.equal(daysRemaining('2026-05-13', now), -2); // 2 days overdue
    assert.equal(daysRemaining(null, now), null);
    assert.equal(daysRemaining('not-a-date', now), null);
  });

  // 3. Table-Driven Database Error Mapping
  test('3. describeDbError table-driven matrix', () => {
    // E11000 duplicate email
    const errDupEmail = { code: 11000, keyPattern: { email: 1 } };
    const res1 = describeDbError(errDupEmail);
    assert.equal(res1.status, 400);
    assert.match(res1.message, /email/i);

    // E11000 duplicate phone
    const errDupPhone = { code: 11000, keyPattern: { phone: 1 } };
    const res2 = describeDbError(errDupPhone);
    assert.equal(res2.status, 400);
    assert.match(res2.message, /phone number/i);

    // CastError
    const errCast = { name: 'CastError', kind: 'ObjectId' };
    const res3 = describeDbError(errCast);
    assert.equal(res3.status, 400);
    assert.match(res3.message, /record id is not valid/i);

    // ValidationError
    const errVal = {
      name: 'ValidationError',
      errors: {
        name: { message: 'Name is required' },
      },
    };
    const res4 = describeDbError(errVal);
    assert.equal(res4.status, 400);
    assert.equal(res4.message, 'Name is required');

    // Generic fallback
    const errGen = new Error('Custom database error');
    const res5 = describeDbError(errGen, 'Fallback message');
    assert.equal(res5.status, 500);
    assert.equal(res5.message, 'Custom database error');
  });

  // 4. Duplicate User Detection
  describe('duplicateUser utility', () => {
    before(async () => {
      await setupTestDb();
      await User.deleteMany({ email: /^unit_dup_/ });
      await User.create({
        name: 'Unit Dup Member',
        email: 'unit_dup_member@example.com',
        phone: '9876549001',
        password: 'password123',
        role: 'member',
      });
    });

    after(async () => {
      await User.deleteMany({ email: /^unit_dup_/ });
      await teardownTestDb();
    });

    test('normaliseEmail trims and lowercases; normalisePhone formats 10-digits', () => {
      assert.equal(normaliseEmail('  TEST@Example.COM '), 'test@example.com');
      assert.equal(normalisePhone('+91 98765 49001'), '9876549001');
    });

    test('findDuplicate detects duplicate email or phone, ignores self ID', async () => {
      // Clash on email
      const clashEmail = await findDuplicate({ email: 'unit_dup_member@example.com' });
      assert.ok(clashEmail);
      assert.equal(clashEmail.field, 'email');

      // Clash on phone with +91 prefix
      const clashPhone = await findDuplicate({ phone: '+91 98765 49001' });
      assert.ok(clashPhone);
      assert.equal(clashPhone.field, 'phone');

      // Self-update exclusion (excludeId = user._id) -> no clash
      const existing = await User.findOne({ email: 'unit_dup_member@example.com' });
      const noClash = await findDuplicate({
        email: 'unit_dup_member@example.com',
        phone: '9876549001',
        excludeId: existing._id,
      });
      assert.equal(noClash, null, 'Updating own profile must not clash with self');
    });
  });
});
