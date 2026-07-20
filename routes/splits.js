const express = require('express');
const router = express.Router();
const WorkoutSplit = require('../models/WorkoutSplit');
const { protect, trainerOrAdmin } = require('../middleware/auth');
const cache = require('../utils/cache');

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// GET /api/splits/me  - get the split assigned to me (or default)
router.get('/me', protect, async (req, res) => {
  try {
    let split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true })
      .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration');
    if (!split) {
      split = await WorkoutSplit.findOne({ isDefault: true, isActive: true })
        .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration');
    }
    res.json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Personal Planner: member self-manages their own planner split ──────────────

// GET /api/splits/planner — get or auto-create the member's personal planner split
router.get('/planner', protect, async (req, res) => {
  try {
    const cacheKey = `split:planner:${req.user._id}`;
    let split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true, title: '__personal_planner__' })
      .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration image');
    if (!split) {
      // Create empty personal planner
      split = await WorkoutSplit.create({
        title: '__personal_planner__',
        member: req.user._id,
        createdBy: req.user._id,
        goal: 'general',
        isDefault: false,
        isActive: true,
        days: DAYS.map(d => ({ day: d, focus: '', exercises: [], notes: '' })),
      });
      split = await WorkoutSplit.findById(split._id)
        .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration image');
    }
    cache.del(cacheKey);
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
    // re-populate after save
    split = await WorkoutSplit.findById(split._id)
      .populate('days.exercises', 'title muscleGroup videoUrl video thumbnail difficulty sets reps duration image');
    cache.del(`split:planner:${req.user._id}`);
    res.json(split);
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
    res.status(201).json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/splits/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const split = await WorkoutSplit.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!split) return res.status(404).json({ message: 'Split not found' });
    res.json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/splits/:id
router.delete('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    await WorkoutSplit.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
