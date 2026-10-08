const WorkoutSplit = require('../models/WorkoutSplit.model');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');
const { asyncHandler } = require('../utils/asyncHandler');

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const SPLITS_LIST_KEY = 'splits:all';

// GET /api/splits/me
const getMySplit = asyncHandler(async (req, res) => {
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
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/splits/planner
const getPlanner = asyncHandler(async (req, res) => {
  try {
    const cacheKey = `split:planner:${req.user._id}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    let split = await WorkoutSplit.findOne({ member: req.user._id, isActive: true, title: '__personal_planner__' })
      .populate('days.exercises', 'title muscleGroup videoUrl video difficulty sets reps duration image')
      .lean();

    if (!split) {
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

    cache.set(cacheKey, split, 60);
    res.json(split);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/splits/planner
const savePlanner = asyncHandler(async (req, res) => {
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

    const populated = await WorkoutSplit.findById(split._id)
      .populate('days.exercises', 'title muscleGroup videoUrl video difficulty sets reps duration image')
      .lean();

    cache.set(`split:planner:${req.user._id}`, populated, 60);
    res.json(populated);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/splits
const getAllSplits = asyncHandler(async (req, res) => {
  try {
    const splits = await cache.getOrSet(SPLITS_LIST_KEY, 60, () =>
      WorkoutSplit.find({ title: { $ne: '__personal_planner__' } })
        .populate('member', 'name')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(splits);
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/splits
const createSplit = asyncHandler(async (req, res) => {
  try {
    const split = await WorkoutSplit.create({ ...req.body, createdBy: req.user._id });
    if (split.isDefault) {
      await WorkoutSplit.updateMany({ _id: { $ne: split._id } }, { isDefault: false });
      cache.delPattern('split:assigned:');
    }
    if (req.body.member) cache.del(`split:assigned:${req.body.member}`);
    cache.del(SPLITS_LIST_KEY);
    res.status(201).json(split);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/splits/:id
const updateSplit = asyncHandler(async (req, res) => {
  try {
    const split = await WorkoutSplit.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!split) return res.status(404).json({ message: 'Split not found' });
    if (split.isDefault) {
      await WorkoutSplit.updateMany({ _id: { $ne: split._id } }, { isDefault: false });
    }
    if (split.member) cache.del(`split:assigned:${split.member}`);
    cache.del(SPLITS_LIST_KEY);
    cache.delPattern('split:assigned:');
    res.json(split);
  } catch (err) {
    sendDbError(res, err);
  }
});

// DELETE /api/splits/:id
const deleteSplit = asyncHandler(async (req, res) => {
  try {
    const split = await WorkoutSplit.findById(req.params.id);
    if (split?.member) cache.del(`split:assigned:${split.member}`);
    cache.del(SPLITS_LIST_KEY);
    await WorkoutSplit.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = {
  getMySplit,
  getPlanner,
  savePlanner,
  getAllSplits,
  createSplit,
  updateSplit,
  deleteSplit,
};
