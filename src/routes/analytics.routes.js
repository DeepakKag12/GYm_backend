const express = require('express');
const router = express.Router();
const {
  getSummary,
  getTrainerSummary,
  getRevenueMonthly,
  getMembershipStats,
  getNewMembersMonthly,
  getRevenueFull,
  resetToProduction,
  resetAnalytics,
} = require('../controllers/analytics.controller');
const { protect, adminOnly, trainerOrAdmin } = require('../middlewares/auth.middleware');

router.get('/', protect, adminOnly, getSummary);
router.get('/summary', protect, adminOnly, getSummary);
router.get('/trainer-summary', protect, trainerOrAdmin, getTrainerSummary);
router.get('/revenue-monthly', protect, adminOnly, getRevenueMonthly);
router.get('/membership-stats', protect, adminOnly, getMembershipStats);
router.get('/new-members-monthly', protect, adminOnly, getNewMembersMonthly);
router.get('/revenue-full', protect, adminOnly, getRevenueFull);
router.post('/reset-to-production', protect, adminOnly, resetToProduction);
router.post('/reset', protect, adminOnly, resetAnalytics);

module.exports = router;
