const express = require('express');
const router = express.Router();
const WorkoutSplit = require('../models/WorkoutSplit');
const { protect, trainerOrAdmin } = require('../middleware/auth');

// GET /api/splits/me  - get the split assigned to me (or default)
router.get('/me', protect, async (req, res) => {
  try {
    let split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true })
      .populate('days.exercises', 'title muscleGroup videoUrl thumbnail difficulty');
    if (!split) {
      split = await WorkoutSplit.findOne({ isDefault: true, isActive: true })
        .populate('days.exercises', 'title muscleGroup videoUrl thumbnail difficulty');
    }
    res.json(split);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/splits - admin/trainer: all splits
router.get('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    const splits = await WorkoutSplit.find().populate('member', 'name').sort({ createdAt: -1 });
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
