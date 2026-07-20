const express = require('express');
const router = express.Router();
const Transformation = require('../models/Transformation');
const cloudinary = require('../config/cloudinary');
const { protect, trainerOrAdmin } = require('../middleware/auth');
const cache = require('../utils/cache');

/** Upload to Cloudinary — buffer-safe (Vercel) + auto image compression */
async function uploadImage(file, folder = 'transformations') {
  const cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    throw new Error(
      'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, ' +
      'CLOUDINARY_API_SECRET to your Vercel environment variables and redeploy.'
    );
  }
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
    const transformations = await cache.getOrSet('transformations:public', 120, () =>
      Transformation.find({ isPublic: true })
        .populate('member', 'name avatar')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
    res.json(transformations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/transformations/all - admin/trainer: all
router.get('/all', protect, trainerOrAdmin, async (req, res) => {
  try {
    const transformations = await cache.getOrSet('transformations:all', 60, () =>
      Transformation.find()
        .populate('member', 'name avatar')
        .sort({ createdAt: -1 })
        .lean()
    );
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
    cache.delPattern('transformations:');
    res.status(201).json(transformation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/transformations/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const t = await Transformation.findById(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });

    let beforeImage = t.beforeImage;
    let afterImage  = t.afterImage;

    if (req.files?.beforeImage) {
      const r = await uploadImage(req.files.beforeImage, 'transformations');
      beforeImage = r.secure_url;
    }
    if (req.files?.afterImage) {
      const r = await uploadImage(req.files.afterImage, 'transformations');
      afterImage = r.secure_url;
    }

    const updated = await Transformation.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        beforeImage,
        afterImage,
        isPublic: req.body.isPublic === 'false' ? false : req.body.isPublic === 'true' ? true : t.isPublic,
      },
      { new: true }
    );
    cache.delPattern('transformations:');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/transformations/:id
router.delete('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    await Transformation.findByIdAndDelete(req.params.id);
    cache.delPattern('transformations:');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
