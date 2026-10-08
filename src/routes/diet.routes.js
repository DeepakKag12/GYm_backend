const express = require('express');
const router = express.Router();
const DietPlan = require('../models/DietPlan.model');
const cloudinary = require('../config/cloudinary');
const { protect, trainerOrAdmin } = require('../middlewares/auth.middleware');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');

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
        const User = require('../models/User.model');
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
      res.set('Cache-Control', 'private, max-age=90, stale-while-revalidate=180');
    } else {
      plans = await DietPlan.find(query).populate('uploadedBy', 'name').sort({ createdAt: -1 }).lean();
    }
    res.json(plans);
  } catch (err) {
    sendDbError(res, err);
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
    sendDbError(res, err);
  }
});

// GET /api/diet/:id
router.get('/:id', async (req, res) => {
  try {
    const plan = await DietPlan.findById(req.params.id).populate('uploadedBy', 'name').lean();
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' });

    if (!plan.isPublic) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'Authentication required to view private diet plan.' });
      }
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const User = require('../models/User.model');
        const user = await User.findById(decoded.id).select('role').lean();
        if (!user) return res.status(401).json({ message: 'User not found.' });

        const isStaff = user.role === 'admin' || user.role === 'trainer';
        const isAssigned = Array.isArray(plan.assignedTo) && plan.assignedTo.some(id => String(id) === String(user._id));
        if (!isStaff && !isAssigned) {
          return res.status(403).json({ message: 'Access denied to private diet plan.' });
        }
      } catch {
        return res.status(401).json({ message: 'Invalid or expired authentication token.' });
      }
    } else {
      res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
    }

    res.json(plan);
  } catch (err) {
    sendDbError(res, err);
  }
});

function safeParseArray(val, fallback = []) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

// POST /api/diet
router.post('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    let imageUrl = '';
    if (req.files?.image) {
      const result = await uploadImage(req.files.image, 'diet');
      imageUrl = result.secure_url;
    }
    const meals = req.body.meals ? safeParseArray(req.body.meals) : [];
    const assignedTo = req.body.assignedTo ? safeParseArray(req.body.assignedTo) : [];

    const isPublic = !(req.body.isPublic === 'false' || req.body.isPublic === false);

    const plan = await DietPlan.create({
      ...req.body,
      meals,
      assignedTo,
      image: imageUrl,
      uploadedBy: req.user._id,
      isPublic,
    });
    cache.delPattern('diet:');
    res.status(201).json(plan);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/diet/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.meals !== undefined) updates.meals = safeParseArray(updates.meals);
    if (updates.assignedTo !== undefined) updates.assignedTo = safeParseArray(updates.assignedTo);
    if (updates.isPublic !== undefined) {
      updates.isPublic = !(updates.isPublic === 'false' || updates.isPublic === false);
    }
    if (req.files?.image) {
      const result = await uploadImage(req.files.image, 'diet');
      updates.image = result.secure_url;
    }
    const plan = await DietPlan.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!plan) return res.status(404).json({ message: 'Not found' });
    cache.del(`diet:item:${req.params.id}`);
    cache.delPattern('diet:');
    res.json(plan);
  } catch (err) {
    sendDbError(res, err);
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
    sendDbError(res, err);
  }
});

module.exports = router;
