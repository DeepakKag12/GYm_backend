const bcrypt = require('bcryptjs');
const User = require('../models/User.model');
const cache = require('../utils/cache');
const { findDuplicate } = require('../utils/duplicateUser');
const { sendDbError } = require('../utils/dbError');
const { asyncHandler } = require('../utils/asyncHandler');
const { protect, adminOnly } = require('../middlewares/auth.middleware');

const TRAINERS_CACHE_KEY = 'trainers:active';
const MEMBERS_CACHE_KEY_MIRROR = 'members:all';

// GET /api/trainers
const getAllTrainers = asyncHandler(async (req, res) => {
  try {
    if (req.query.all === '1') {
      return protect(req, res, () => adminOnly(req, res, async () => {
        const all = await User.find({ role: 'trainer' }).select('-password').lean();
        res.set('Cache-Control', 'no-store');
        res.json(all);
      }));
    }
    const trainers = await cache.getOrSet(TRAINERS_CACHE_KEY, 180, () =>
      User.find({ role: 'trainer', isActive: true }).select('-password').lean()
    );
    res.set('Cache-Control', 'private, max-age=180, stale-while-revalidate=360');
    res.json(trainers);
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/trainers
const createTrainer = asyncHandler(async (req, res) => {
  try {
    const { name, email, phone, password, specialization, gender, isActive } = req.body;
    const clash = await findDuplicate({ email, phone });
    if (clash) {
      return res.status(409).json({
        message: clash.message,
        field: clash.field,
        existingUser: { _id: clash.user._id, name: clash.user.name, role: clash.user.role },
      });
    }
    const hashed = await bcrypt.hash(password || phone, 10);
    const trainer = await User.create({
      name, email, phone,
      password: hashed,
      role: 'trainer',
      specialization: specialization || '',
      gender: gender || '',
      isActive: isActive !== undefined ? isActive : true,
    });
    cache.del(TRAINERS_CACHE_KEY);
    cache.del(MEMBERS_CACHE_KEY_MIRROR);
    cache.del('users:admin:all');
    const safe = trainer.toObject(); delete safe.password;
    res.status(201).json(safe);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/trainers/:id
const updateTrainer = asyncHandler(async (req, res) => {
  try {
    const { name, email, phone, password, specialization, gender, isActive } = req.body;

    if (email || phone) {
      const clash = await findDuplicate({ email, phone, excludeId: req.params.id });
      if (clash) {
        return res.status(409).json({
          message: clash.message,
          field: clash.field,
          existingUser: { _id: clash.user._id, name: clash.user.name, role: clash.user.role },
        });
      }
    }

    const update = {};
    if (name           !== undefined) update.name           = name;
    if (email          !== undefined) update.email          = email;
    if (phone          !== undefined) update.phone          = phone;
    if (specialization !== undefined) update.specialization = specialization;
    if (gender         !== undefined) update.gender         = gender;
    if (isActive       !== undefined) update.isActive       = isActive;
    if (password) {
      update.password = await bcrypt.hash(password, 10);
    }
    const trainer = await User.findByIdAndUpdate(req.params.id, update, {
      new: true, runValidators: true, context: 'query',
    }).select('-password');
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' });
    cache.del(TRAINERS_CACHE_KEY);
    cache.del(MEMBERS_CACHE_KEY_MIRROR);
    cache.del('users:admin:all');
    res.json(trainer);
  } catch (err) {
    sendDbError(res, err);
  }
});

// DELETE /api/trainers/:id
const deleteTrainer = asyncHandler(async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Trainer not found' });
    await User.updateMany({ assignedTrainer: req.params.id }, { $unset: { assignedTrainer: 1 } });
    cache.del(TRAINERS_CACHE_KEY);
    cache.del(MEMBERS_CACHE_KEY_MIRROR);
    cache.del('users:admin:all');
    res.json({ message: 'Trainer deleted' });
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = {
  getAllTrainers,
  createTrainer,
  updateTrainer,
  deleteTrainer,
};
