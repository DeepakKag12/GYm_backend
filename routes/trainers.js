const express = require('express');
const { findDuplicate } = require('../utils/duplicateUser');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');

const bcrypt = require('bcryptjs');
const { sendDbError } = require('../utils/dbError');

const TRAINERS_CACHE_KEY = 'trainers:active';
// Deleting a trainer rewrites member documents, so the members list cache
// (owned by routes/members.js) has to be dropped too.
const MEMBERS_CACHE_KEY_MIRROR = 'members:all';

// GET /api/trainers — public list is active-only; ?all=1 (admin) includes
// deactivated trainers, which the admin panel needs in order to re-enable them.
router.get('/', async (req, res) => {
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
    res.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=360');
    res.json(trainers);
  } catch (err) { sendDbError(res, err); }
});

// POST /api/trainers - admin adds trainer
router.post('/', protect, adminOnly, async (req, res) => {
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
    const safe = trainer.toObject(); delete safe.password;
    res.status(201).json(safe);
  } catch (err) { sendDbError(res, err); }
});

// PUT /api/trainers/:id - admin edits trainer
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, password, specialization, gender, isActive } = req.body;

    // Same guard as create: an edit must not take another account's identity.
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

    const update = { name, email, phone };
    if (specialization !== undefined) update.specialization = specialization;
    if (gender        !== undefined) update.gender         = gender;
    if (isActive      !== undefined) update.isActive       = isActive;
    if (password) {
      update.password = await bcrypt.hash(password, 10);
    }
    const trainer = await User.findByIdAndUpdate(req.params.id, update, {
      new: true, runValidators: true, context: 'query',
    }).select('-password');
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' });
    cache.del(TRAINERS_CACHE_KEY);
    res.json(trainer);
  } catch (err) { sendDbError(res, err); }
});

// DELETE /api/trainers/:id - admin deletes trainer
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Trainer not found' });
    // Clear the dangling pointer on every member who was assigned to them
    await User.updateMany({ assignedTrainer: req.params.id }, { $unset: { assignedTrainer: 1 } });
    cache.del(TRAINERS_CACHE_KEY);
    cache.del(MEMBERS_CACHE_KEY_MIRROR);
    res.json({ message: 'Trainer deleted' });
  } catch (err) { sendDbError(res, err); }
});

module.exports = router;
