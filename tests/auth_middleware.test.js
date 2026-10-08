const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adminOnly, trainerOrAdmin } = require('../src/middlewares/auth.middleware');

test('Role guards grant or reject appropriately', () => {
  // adminOnly
  let calledNext = false;
  const mockReqAdmin = { user: { role: 'admin' } };
  const mockRes = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  adminOnly(mockReqAdmin, mockRes, () => { calledNext = true; });
  assert.equal(calledNext, true);

  calledNext = false;
  const mockReqMember = { user: { role: 'member' } };
  adminOnly(mockReqMember, mockRes, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(mockRes.statusCode, 403);
  assert.equal(mockRes.body.message, 'Admin access only');

  // trainerOrAdmin
  calledNext = false;
  const mockReqTrainer = { user: { role: 'trainer' } };
  trainerOrAdmin(mockReqTrainer, mockRes, () => { calledNext = true; });
  assert.equal(calledNext, true);

  calledNext = false;
  trainerOrAdmin(mockReqMember, mockRes, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.equal(mockRes.statusCode, 403);
  assert.equal(mockRes.body.message, 'Trainer or Admin access only');
});
