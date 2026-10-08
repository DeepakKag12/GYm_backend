const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalPhone } = require('../src/utils/phone');

test('canonicalPhone normalizes Indian phone numbers correctly', () => {
  // Plain 10 digits
  assert.equal(canonicalPhone('9876543210'), '9876543210');

  // Spaces and dashes
  assert.equal(canonicalPhone('98765 43210'), '9876543210');
  assert.equal(canonicalPhone('98765-43210'), '9876543210');

  // +91 format
  assert.equal(canonicalPhone('+91 98765 43210'), '9876543210');
  assert.equal(canonicalPhone('+919876543210'), '9876543210');

  // Trunk 0 format
  assert.equal(canonicalPhone('09876543210'), '9876543210');

  // 0091 international format
  assert.equal(canonicalPhone('00919876543210'), '9876543210');

  // Empty / falsy
  assert.equal(canonicalPhone(''), '');
  assert.equal(canonicalPhone(null), '');
  assert.equal(canonicalPhone(undefined), '');
});
