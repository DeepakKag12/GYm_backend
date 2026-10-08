const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeDbError } = require('../src/utils/dbError');

test('describeDbError maps Mongo errors to friendly client responses', () => {
  // Duplicate key (E11000)
  const dupEmail = {
    code: 11000,
    keyPattern: { email: 1 }
  };
  const resDup = describeDbError(dupEmail);
  assert.equal(resDup.status, 400);
  assert.match(resDup.message, /email address is already used/);

  // Validation Error (Missing required field)
  const validationErr = {
    name: 'ValidationError',
    errors: {
      phone: { kind: 'required', path: 'phone' }
    }
  };
  const resVal = describeDbError(validationErr);
  assert.equal(resVal.status, 400);
  assert.match(resVal.message, /Please provide a phone number/);

  // Invalid ObjectId (CastError)
  const castErr = {
    name: 'CastError',
    kind: 'ObjectId'
  };
  const resCast = describeDbError(castErr);
  assert.equal(resCast.status, 400);
  assert.equal(resCast.message, 'That record id is not valid.');

  // Generic unhandled error
  const genErr = new Error('Database connection timed out');
  const resGen = describeDbError(genErr);
  assert.equal(resGen.status, 500);
  assert.equal(resGen.message, 'Database connection timed out');
});
