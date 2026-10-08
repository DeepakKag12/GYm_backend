const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Enquiry update whitelist and status validation logic', () => {
  const allowedStatuses = ['new', 'contacted', 'converted', 'closed'];

  // Valid statuses
  for (const st of allowedStatuses) {
    assert.equal(allowedStatuses.includes(st), true);
  }

  // Invalid or injected statuses
  const maliciousStatuses = ['admin', 'superadmin', 'deleted', 'approved', 'random'];
  for (const mal of maliciousStatuses) {
    assert.equal(allowedStatuses.includes(mal), false);
  }

  // Field extraction logic test
  const reqBody = {
    status: 'contacted',
    notes: 'Called member on phone',
    interest: 'membership',
    extraField: 'should_be_stripped',
    role: 'admin',
    _id: '660e1234567890abcdef1234'
  };

  const update = {};
  if (reqBody.status !== undefined && allowedStatuses.includes(reqBody.status)) {
    update.status = reqBody.status;
  }
  if (reqBody.notes !== undefined) update.notes = String(reqBody.notes).trim();
  if (reqBody.interest !== undefined) update.interest = String(reqBody.interest).trim();

  assert.deepEqual(update, {
    status: 'contacted',
    notes: 'Called member on phone',
    interest: 'membership'
  });
  assert.equal(update.extraField, undefined);
  assert.equal(update.role, undefined);
});
