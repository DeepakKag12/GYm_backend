const express = require('express');
const router = express.Router();
const {
  getRoster,
  getMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  updateMemberRole,
  sendIndividualReminder,
  runRemindersSweep,
  sendBulkReminder,
  sendMemberNotification,
} = require('../controllers/members.controller');
const { protect, adminOnly, trainerOrAdmin } = require('../middlewares/auth.middleware');

router.get('/roster', protect, trainerOrAdmin, getRoster);
router.get('/', protect, adminOnly, getMembers);
router.post('/', protect, adminOnly, createMember);
router.post('/run-reminders', protect, adminOnly, runRemindersSweep);
router.post('/bulk-reminder', protect, adminOnly, sendBulkReminder);
router.get('/:id', protect, getMemberById);
router.put('/:id', protect, adminOnly, updateMember);
router.delete('/:id', protect, adminOnly, deleteMember);
router.patch('/:id/role', protect, adminOnly, updateMemberRole);
router.post('/:id/reminder', protect, adminOnly, sendIndividualReminder);
router.post('/:id/send-notification', protect, adminOnly, sendMemberNotification);

module.exports = router;
