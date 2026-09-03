const express = require('express');
const router = express.Router();
const MembershipPlan = require('../models/MembershipPlan');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');

const PLANS_CACHE_KEY = 'membership:plans:active';

// GET /api/plans  - public: list all active plans
router.get('/', async (req, res) => {
  try {
    const plans = await cache.getOrSet(PLANS_CACHE_KEY, 300, () =>
      MembershipPlan.find({ isActive: true }).sort({ price: 1 }).lean()
    );
    res.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
    res.json(plans);
  } catch (err) { sendDbError(res, err); }
});

// POST /api/plans - admin
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const plan = await MembershipPlan.create(req.body);
    cache.del(PLANS_CACHE_KEY);
    res.status(201).json(plan);
  } catch (err) { sendDbError(res, err); }
});

// PUT /api/plans/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const plan = await MembershipPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    cache.del(PLANS_CACHE_KEY);
    res.json(plan);
  } catch (err) { sendDbError(res, err); }
});

// DELETE /api/plans/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await MembershipPlan.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Plan not found' });
    cache.del(PLANS_CACHE_KEY);
    res.json({ message: 'Deleted' });
  } catch (err) { sendDbError(res, err); }
});

module.exports = router;
