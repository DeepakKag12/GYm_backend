const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middlewares/auth.middleware');
const {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
} = require('../controllers/plans.controller');

// Public route to list plans (and ?all=1 for admin view)
router.get('/', getAllPlans);

// Protected admin routes
router.post('/', protect, adminOnly, createPlan);
router.put('/:id', protect, adminOnly, updatePlan);
router.delete('/:id', protect, adminOnly, deletePlan);

module.exports = router;
