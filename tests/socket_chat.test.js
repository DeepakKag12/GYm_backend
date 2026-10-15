const test = require('node:test');
const assert = require('node:assert/strict');
const { getConversationId } = require('../src/models/Message.model');
const { isUserOnline, getOnlineUserIds, emitToUser, emitToRole, broadcastEvent } = require('../src/socket');

test('getConversationId produces consistent deterministic ID regardless of order', () => {
  const userA = '64e8b0a51234567890123456';
  const userB = '64e8b0a51234567890123457';

  const conv1 = getConversationId(userA, userB);
  const conv2 = getConversationId(userB, userA);

  assert.equal(conv1, conv2);
  assert.equal(conv1, `${userA}:${userB}`);
  assert.equal(getConversationId('', userA), '');
  assert.equal(getConversationId(userA, null), '');
});

test('Socket helper methods handle uninitialized states gracefully without throwing', () => {
  assert.equal(isUserOnline('non-existent-user'), false);
  assert.deepEqual(getOnlineUserIds(), []);
  assert.equal(emitToUser('user123', 'test_event', {}), false);
  assert.equal(emitToRole('admin', 'test_event', {}), false);
  assert.equal(broadcastEvent('test_event', {}), false);
});
