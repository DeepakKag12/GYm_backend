const express = require('express');
const router = express.Router();
const ProgressEntry = require('../models/ProgressEntry');
const { protect, adminOnly, trainerOrAdmin } = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');
const cache = require('../utils/cache');

/** Upload to Cloudinary — buffer-safe (Vercel) + auto image compression */
async function uploadPhoto(file) {
  const opts = { folder: 'progress', quality: 'auto', fetch_format: 'auto' };
  if (file.tempFilePath) return cloudinary.uploader.upload(file.tempFilePath, opts);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(opts, (err, r) => err ? reject(err) : resolve(r));
    stream.end(file.data);
  });
}

function progressKey(id) { return `progress:member:${id}`; }

// GET /api/progress/me  - member sees own entries
router.get('/me', protect, async (req, res) => {
  try {
    const entries = await cache.getOrSet(progressKey(req.user._id), 60, () =>
      ProgressEntry.find({ member: req.user._id }).sort({ date: -1 }).lean()
    );
    res.json(entries);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/progress/:memberId  - trainer/admin sees a member's entries
router.get('/:memberId', protect, trainerOrAdmin, async (req, res) => {
  try {
    const entries = await cache.getOrSet(progressKey(req.params.memberId), 60, () =>
      ProgressEntry.find({ member: req.params.memberId }).sort({ date: -1 }).lean()
    );
    res.json(entries);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/progress  - member logs own progress (with optional photo)
router.post('/', protect, async (req, res) => {
  try {
    const { date, weight, bodyFat, chest, waist, hips, arms, thighs, notes } = req.body;
    let photoUrl = '';
    if (req.files?.photo) {
      const result = await uploadPhoto(req.files.photo);
      photoUrl = result.secure_url;
    }
    const entry = await ProgressEntry.create({
      member: req.user._id, date, weight, bodyFat, chest, waist, hips, arms, thighs, notes, photo: photoUrl
    });
    cache.del(progressKey(req.user._id));
    res.status(201).json(entry);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/progress/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const entry = await ProgressEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Entry not found' });
    if (entry.member.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await entry.deleteOne();
    cache.del(progressKey(req.user._id));
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
