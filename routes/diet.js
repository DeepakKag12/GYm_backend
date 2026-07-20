const express = require('express');
const router = express.Router();
const DietPlan = require('../models/DietPlan');
const cloudinary = require('../config/cloudinary');
const { protect, trainerOrAdmin } = require('../middleware/auth');
const cache = require('../utils/cache');

/** Upload to Cloudinary — buffer-safe (Vercel) + auto image compression */
async function uploadImage(file, folder = 'diet') {
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

// GET /api/diet
router.get('/', async (req, res) => {
  try {
    let query = { isPublic: true };
    const authHeader = req.headers.authorization;
    let cacheKey = 'diet:public';

    if (authHeader) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const User = require('../models/User');
        const user = await User.findById(decoded.id).select('role').lean();
        if (user && (user.role === 'admin' || user.role === 'trainer')) {
          query = {};
          cacheKey = 'diet:staff';
        } else {
          query = { $or: [{ isPublic: true }, { assignedTo: decoded.id }] };
          cacheKey = null; // personalised — don't cache
        }
      } catch {}
    }

    let plans;
    if (cacheKey) {
      plans = await cache.getOrSet(cacheKey, 90, () =>
        DietPlan.find(query).populate('uploadedBy', 'name').sort({ createdAt: -1 }).lean()
      );
      res.set('Cache-Control', 'public, max-age=90, stale-while-revalidate=180');
    } else {
      plans = await DietPlan.find(query).populate('uploadedBy', 'name').sort({ createdAt: -1 }).lean();
    }
    res.json(plans);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/diet/my -- member: only diet plans assigned to them (protected)
router.get('/my', protect, async (req, res) => {
  try {
    const cacheKey = `diet:member:${req.user._id}`;
    const plans = await cache.getOrSet(cacheKey, 60, () =>
      DietPlan.find({ assignedTo: req.user._id })
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(plans);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/diet/:id
router.get('/:id', async (req, res) => {
  try {
    const cacheKey = `diet:item:${req.params.id}`;
    const plan = await cache.getOrSet(cacheKey, 120, () =>
      DietPlan.findById(req.params.id).populate('uploadedBy', 'name').lean()
    );
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' });
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
    res.json(plan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/diet
router.post('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    let imageUrl = '';
    if (req.files?.image) {
      const result = await uploadImage(req.files.image, 'diet');
      imageUrl = result.secure_url;
    }
    const meals = req.body.meals ? JSON.parse(req.body.meals) : [];
    const assignedTo = req.body.assignedTo ? JSON.parse(req.body.assignedTo) : [];

    const plan = await DietPlan.create({
      ...req.body,
      meals,
      assignedTo,
      image: imageUrl,
      uploadedBy: req.user._id,
      isPublic: req.body.isPublic === 'false' ? false : true,
    });
    cache.delPattern('diet:');
    res.status(201).json(plan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/diet/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const plan = await DietPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!plan) return res.status(404).json({ message: 'Not found' });
    cache.del(`diet:item:${req.params.id}`);
    cache.delPattern('diet:public');
    cache.delPattern('diet:staff');
    res.json(plan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/diet/:id
router.delete('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    await DietPlan.findByIdAndDelete(req.params.id);
    cache.del(`diet:item:${req.params.id}`);
    cache.delPattern('diet:public');
    cache.delPattern('diet:staff');
    res.json({ message: 'Diet plan deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
