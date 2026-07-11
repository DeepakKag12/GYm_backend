const express = require('express');
const router = express.Router();
const MembershipPlan = require('../models/MembershipPlan');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/plans  - public: list all active plans
router.get('/', async (req, res) => {
  try {
    const plans = await MembershipPlan.find({ isActive: true }).sort({ price: 1 });
    res.json(plans);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/plans - admin
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const plan = await MembershipPlan.create(req.body);
    res.status(201).json(plan);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/plans/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const plan = await MembershipPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    res.json(plan);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/plans/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await MembershipPlan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
