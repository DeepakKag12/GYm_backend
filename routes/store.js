const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const cloudinary = require('../config/cloudinary');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');

/** Upload to Cloudinary — buffer-safe (Vercel) + auto image compression */
async function uploadImage(file, folder = 'store') {
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

// GET /api/store?category=protein
router.get('/', async (req, res) => {
  try {
    const { category, featured, search } = req.query;
    const cacheKey = `store:list:${category || ''}:${featured || ''}:${search || ''}`;
    const products = await cache.getOrSet(cacheKey, 60, async () => {
      let query = { isActive: true };
      if (category) query.category = category;
      if (featured) query.isFeatured = true;
      if (search) query.name = { $regex: search, $options: 'i' };
      return Product.find(query).sort({ createdAt: -1 }).lean();
    });
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/store/:id
router.get('/:id', async (req, res) => {
  try {
    const cacheKey = `store:item:${req.params.id}`;
    const product = await cache.getOrSet(cacheKey, 120, async () => {
      const p = await Product.findById(req.params.id).populate('reviews.user', 'name avatar').lean();
      return p;
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/store - admin adds product
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    let images = [];
    if (req.files?.images) {
      const files = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
      for (const file of files) {
        const result = await uploadImage(file, 'store');
        images.push(result.secure_url);
      }
    }
    const product = await Product.create({
      ...req.body,
      images,
      flavors: req.body.flavors ? JSON.parse(req.body.flavors) : [],
      weights: req.body.weights ? JSON.parse(req.body.weights) : [],
    });
    cache.delPattern('store:list');
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/store/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const update = { ...req.body };
    // Handle arrays that come as JSON strings
    if (typeof update.flavors === 'string') {
      try { update.flavors = JSON.parse(update.flavors); } catch { update.flavors = update.flavors.split(',').map(s => s.trim()).filter(Boolean); }
    }
    if (typeof update.weights === 'string') {
      try { update.weights = JSON.parse(update.weights); } catch { update.weights = update.weights.split(',').map(s => s.trim()).filter(Boolean); }
    }
    // New images uploaded
    if (req.files?.images) {
      const files = Array.isArray(req.files.images) ? req.files.images : [req.files.images];
      const newImages = [];
      for (const file of files) {
        const result = await uploadImage(file, 'store');
        newImages.push(result.secure_url);
      }
      update.images = newImages;
    }
    update.isActive = update.isActive === 'false' ? false : Boolean(update.isActive ?? true);
    update.isFeatured = update.isFeatured === 'true' || update.isFeatured === true;
    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    cache.del(`store:item:${req.params.id}`);
    cache.delPattern('store:list');
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/store/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    cache.del(`store:item:${req.params.id}`);
    cache.delPattern('store:list');
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/store/:id/review
router.post('/:id/review', protect, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    product.reviews.push({ user: req.user._id, name: req.user.name, rating, comment });
    product.reviewCount = product.reviews.length;
    product.rating = product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length;
    await product.save();
    cache.del(`store:item:${req.params.id}`);
    cache.delPattern('store:list');
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
