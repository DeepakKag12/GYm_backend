const express = require('express');
const router = express.Router();
const MembershipPlan = require('../models/MembershipPlan');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');

const PLANS_CACHE_KEY = 'membership:plans:active';

// GET /api/plans  - public: list active plans; ?all=1 lists all plans (for admin management)
router.get('/', async (req, res) => {
  try {
    const showAll = req.query.all === '1' || req.query.all === 'true';
    if (showAll) {
      const plans = await MembershipPlan.find().sort({ price: 1 }).lean();
      return res.json(plans);
    }
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
    const { name, slug, durationDays, price, features, isPopular, isActive } = req.body;
    if (!name || !slug || durationDays === undefined || price === undefined) {
      return res.status(400).json({ message: 'Name, slug, durationDays, and price are required fields.' });
    }
    const plan = await MembershipPlan.create({
      name: String(name).trim(),
      slug: String(slug).trim().toLowerCase(),
      durationDays: Number(durationDays),
      price: Number(price),
      features: Array.isArray(features) ? features.map(f => String(f).trim()).filter(Boolean) : [],
      isPopular: Boolean(isPopular),
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });
    cache.del(PLANS_CACHE_KEY);
    res.status(201).json(plan);
  } catch (err) { sendDbError(res, err); }
});

// PUT /api/plans/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { name, slug, durationDays, price, features, isPopular, isActive } = req.body;
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (slug !== undefined) update.slug = String(slug).trim().toLowerCase();
    if (durationDays !== undefined) update.durationDays = Number(durationDays);
    if (price !== undefined) update.price = Number(price);
    if (features !== undefined) update.features = Array.isArray(features) ? features.map(f => String(f).trim()).filter(Boolean) : [];
    if (isPopular !== undefined) update.isPopular = Boolean(isPopular);
    if (isActive !== undefined) update.isActive = Boolean(isActive);

    const plan = await MembershipPlan.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
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
