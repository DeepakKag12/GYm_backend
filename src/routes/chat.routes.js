const express = require('express');
const router = express.Router();
const {
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getContacts,
  getUnreadCount,
} = require('../controllers/chat.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.get('/conversations', getConversations);
router.get('/contacts', getContacts);
router.get('/unread-count', getUnreadCount);
router.get('/messages/:userId', getMessages);
router.post('/messages', sendMessage);
router.put('/read/:userId', markAsRead);

module.exports = router;
