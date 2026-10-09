const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { canonicalPhone } = require('../src/utils/phone');

test('Member fallback password hashes canonical phone and matches login attempts', async () => {
  const inputs = [
    '+91 98765 43210',
    '+919876543210',
    '09876543210',
    '98765-43210',
    ' 98765 43210 ',
  ];

  for (const rawPhone of inputs) {
    // Controller logic: fallbackPassword = canonicalPhone(phone) || phone;
    const fallbackPassword = canonicalPhone(rawPhone) || rawPhone;
    assert.equal(fallbackPassword, '9876543210');

    // Hash generated upon member creation
    const hashed = await bcrypt.hash(fallbackPassword, 10);

    // Member attempts login using standard 10-digit mobile number as password
    const userEnteredPassword = '9876543210';
    const matches = await bcrypt.compare(userEnteredPassword, hashed);
    assert.equal(matches, true, `Bcrypt compare should succeed for normalized password from: "${rawPhone}"`);
  }
});

test('Order idempotency key sanitization protects against malformed inputs', () => {
  const sanitizeKey = (raw) => {
    return typeof raw === 'string' ? raw.trim().slice(0, 100) : undefined;
  };

  assert.equal(sanitizeKey('  ord_123456789_abcdef  '), 'ord_123456789_abcdef');
  assert.equal(sanitizeKey(''), '');
  assert.equal(sanitizeKey(null), undefined);
  assert.equal(sanitizeKey(undefined), undefined);
  assert.equal(sanitizeKey(12345), undefined);
  assert.equal(sanitizeKey({ key: 'test' }), undefined);

  const longKey = 'a'.repeat(200);
  assert.equal(sanitizeKey(longKey).length, 100);
});
