const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Email normalization and validation logic', () => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Valid casing and spaces that must be cleaned
  const rawEmail = '  Member.FitNation@Example.COM  ';
  const normalized = String(rawEmail).trim().toLowerCase();
  assert.equal(normalized, 'member.fitnation@example.com');
  assert.equal(emailRegex.test(normalized), true);

  // Invalid formats that must be rejected
  const invalidEmails = ['plainaddress', '@missingusername.com', 'user@.com', 'user@domain', ''];
  for (const inv of invalidEmails) {
    const norm = String(inv).trim().toLowerCase();
    assert.equal(emailRegex.test(norm), false, `Should reject invalid email: "${inv}"`);
  }
});
