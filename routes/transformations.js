const express = require('express');
const router = express.Router();
const Transformation = require('../models/Transformation');
const cloudinary = require('../config/cloudinary');
const { protect, trainerOrAdmin } = require('../middleware/auth');

/** Upload to Cloudinary — buffer-safe (Vercel) + auto image compression */
async function uploadImage(file, folder = 'transformations') {
  const opts = { folder, quality: 'auto', fetch_format: 'auto' };
  if (file.tempFilePath) return cloudinary.uploader.upload(file.tempFilePath, opts);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(opts, (err, r) => err ? reject(err) : resolve(r));
    stream.end(file.data);
  });
}

// GET /api/transformations
router.get('/', async (req, res) => {
  try {
    const transformations = await Transformation.find({ isPublic: true })
      .populate('member', 'name avatar')
      .sort({ createdAt: -1 });
    res.json(transformations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/transformations/all - admin/trainer: all
router.get('/all', protect, trainerOrAdmin, async (req, res) => {
  try {
    const transformations = await Transformation.find()
      .populate('member', 'name avatar')
      .sort({ createdAt: -1 });
    res.json(transformations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/transformations
router.post('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    let beforeImage = '', afterImage = '';
    if (req.files?.beforeImage) {
      const r = await uploadImage(req.files.beforeImage, 'transformations');
      beforeImage = r.secure_url;
    }
    if (req.files?.afterImage) {
      const r = await uploadImage(req.files.afterImage, 'transformations');
      afterImage = r.secure_url;
    }
    const transformation = await Transformation.create({
      ...req.body,
      beforeImage, afterImage,
      uploadedBy: req.user._id,
      isPublic: req.body.isPublic === 'false' ? false : true,
    });
    res.status(201).json(transformation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/transformations/:id
router.delete('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    await Transformation.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
