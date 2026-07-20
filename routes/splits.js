const express = require('express');
const router = express.Router();
const WorkoutSplit = require('../models/WorkoutSplit');
const { protect, trainerOrAdmin } = require('../middleware/auth');
const cache = require('../utils/cache');

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// GET /api/splits/me  - get the split assigned to me (or default)
router.get('/me', protect, async (req, res) => {
  try {
    const cacheKey = `split:assigned:${req.user._id}`;
    let split = cache.get(cacheKey);
    if (split === undefined) {
      split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true, title: { $ne: '__personal_planner__' } })
        .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration image')
        .lean();
      if (!split) {
        split = await WorkoutSplit.findOne({ isDefault: true, isActive: true })
          .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration image')
          .lean();
      }
      cache.set(cacheKey, split, 120);
    }
    res.json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Personal Planner: member self-manages their own planner split ──────────────

// GET /api/splits/planner — get or auto-create the member's personal planner split
router.get('/planner', protect, async (req, res) => {
  try {
    const cacheKey = `split:planner:${req.user._id}`;

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    let split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true, title: '__personal_planner__' })
      .populate('days.exercises', 'title muscleGroup videoUrl video difficulty sets reps duration image')
      .lean();

    if (!split) {
      // Create empty personal planner
      const created = await WorkoutSplit.create({
        title: '__personal_planner__',
        member: req.user._id,
        createdBy: req.user._id,
        goal: 'general',
        isDefault: false,
        isActive: true,
        days: DAYS.map(d => ({ day: d, focus: '', exercises: [], notes: '' })),
      });
      split = await WorkoutSplit.findById(created._id)
        .populate('days.exercises', 'title muscleGroup videoUrl video difficulty sets reps duration image')
        .lean();
    }

    cache.set(cacheKey, split, 60); // cache for 60s
    res.json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/splits/planner — member saves their planner (only updates days array)
router.put('/planner', protect, async (req, res) => {
  try {
    const { days } = req.body;
    if (!Array.isArray(days)) return res.status(400).json({ message: 'days array required' });

    let split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true, title: '__personal_planner__' });
    if (!split) {
      split = await WorkoutSplit.create({
        title: '__personal_planner__',
        member: req.user._id,
        createdBy: req.user._id,
        goal: 'general',
        isDefault: false,
        isActive: true,
        days: DAYS.map(d => ({ day: d, focus: '', exercises: [], notes: '' })),
      });
    }
    split.days = days;
    await split.save();

    // Re-populate with full exercise objects for the response
    const populated = await WorkoutSplit.findById(split._id)
      .populate('days.exercises', 'title muscleGroup videoUrl video difficulty sets reps duration image')
      .lean();

    // Update cache with fresh data
    cache.set(`split:planner:${req.user._id}`, populated, 60);
    res.json(populated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/splits - admin/trainer: all splits (excludes personal planners)
router.get('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    const splits = await WorkoutSplit.find({ title: { $ne: '__personal_planner__' } })
      .populate('member', 'name').sort({ createdAt: -1 });
    res.json(splits);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/splits
router.post('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    const split = await WorkoutSplit.create({ ...req.body, createdBy: req.user._id });
    // Bust assigned-split cache for the member this was created for
    if (req.body.member) cache.del(`split:assigned:${req.body.member}`);
    res.status(201).json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/splits/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const split = await WorkoutSplit.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!split) return res.status(404).json({ message: 'Split not found' });
    // Bust assigned cache for the member
    if (split.member) cache.del(`split:assigned:${split.member}`);
    cache.delPattern('split:assigned:');
    res.json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/splits/:id
router.delete('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const split = await WorkoutSplit.findById(req.params.id);
    if (split?.member) cache.del(`split:assigned:${split.member}`);
    await WorkoutSplit.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
