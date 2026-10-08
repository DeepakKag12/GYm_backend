const express = require('express');
const router = express.Router();
const {
  getMyNotifications,
  getAllNotificationsAdmin,
  markAllReadAdmin,
  getChannelHealth,
  sendTestNotification,
  sendAdminNotification,
  markAllReadUser,
  markRead,
  deleteNotificationAdmin,
  clearNotificationsBulkAdmin,
} = require('../controllers/notifications.controller');
const { protect, adminOnly } = require('../middlewares/auth.middleware');

router.get('/', protect, getMyNotifications);
router.get('/admin/all', protect, adminOnly, getAllNotificationsAdmin);
router.put('/admin/mark-all-read', protect, adminOnly, markAllReadAdmin);
router.get('/admin/channels', protect, adminOnly, getChannelHealth);
router.post('/admin/test', protect, adminOnly, sendTestNotification);
router.post('/admin/send', protect, adminOnly, sendAdminNotification);
router.put('/read-all', protect, markAllReadUser);
router.put('/:id/read', protect, markRead);
router.delete('/admin/:id', protect, adminOnly, deleteNotificationAdmin);
router.delete('/admin', protect, adminOnly, clearNotificationsBulkAdmin);

module.exports = router;
