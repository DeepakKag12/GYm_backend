const express = require('express');
const router = express.Router();
const Product = require('../models/Product.model');
const cloudinary = require('../config/cloudinary');
const { protect, adminOnly } = require('../middlewares/auth.middleware');
const cache = require('../utils/cache');
const { publicCache } = require('../middlewares/publicCache.middleware');
const { sendDbError } = require('../utils/dbError');

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
router.get('/', publicCache(60), async (req, res) => {
  try {
    const { category, featured, search, all } = req.query;
    const showAll = all === '1' || all === 'true';
    const cacheKey = `store:list:${category || ''}:${featured || ''}:${search || ''}:${showAll ? 'all' : 'active'}`;
    const products = await cache.getOrSet(cacheKey, 60, async () => {
      let query = showAll ? {} : { isActive: true };
      if (category) query.category = category;
      if (featured) query.isFeatured = true;
      if (search) query.name = { $regex: search, $options: 'i' };
      return Product.find(query).sort({ createdAt: -1 }).lean();
    });
    res.json(products);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/store/:id
router.get('/:id', publicCache(120), async (req, res) => {
  try {
    const cacheKey = `store:item:${req.params.id}`;
    const product = await cache.getOrSet(cacheKey, 120, async () => {
      const p = await Product.findById(req.params.id).populate('reviews.user', 'name avatar').lean();
      return p;
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) {
    sendDbError(res, err);
  }
});

function safeArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

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
    const createData = {
      ...req.body,
      images,
      flavors: safeArray(req.body.flavors),
      weights: safeArray(req.body.weights),
    };
    if (createData.isActive !== undefined) {
      createData.isActive = !(createData.isActive === 'false' || createData.isActive === false);
    }
    if (createData.isFeatured !== undefined) {
      createData.isFeatured = createData.isFeatured === 'true' || createData.isFeatured === true;
    }
    if (createData.price !== undefined) {
      createData.price = Number(createData.price);
      if (Number.isNaN(createData.price) || createData.price < 0) {
        return res.status(400).json({ message: 'Price must be a valid non-negative number.' });
      }
    }
    if (createData.discountPrice !== undefined && createData.discountPrice !== '') {
      createData.discountPrice = Number(createData.discountPrice);
      if (Number.isNaN(createData.discountPrice) || createData.discountPrice < 0) {
        return res.status(400).json({ message: 'Discount price must be a valid non-negative number.' });
      }
      if (createData.price !== undefined && createData.discountPrice > createData.price) {
        return res.status(400).json({ message: 'Discount price cannot exceed the original price.' });
      }
    }
    if (createData.stock !== undefined && createData.stock !== '') {
      createData.stock = Number(createData.stock);
      if (Number.isNaN(createData.stock) || createData.stock < 0) {
        return res.status(400).json({ message: 'Stock must be a valid non-negative number.' });
      }
    }

    const product = await Product.create(createData);
    cache.delPattern('store:list');
    res.status(201).json(product);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/store/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const update = { ...req.body };
    if (update.flavors !== undefined) update.flavors = safeArray(update.flavors);
    if (update.weights !== undefined) update.weights = safeArray(update.weights);

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
    // Only coerce when the field was actually sent. Recomputing unconditionally
    // meant any partial edit re-activated a hidden product and cleared "featured".
    if (update.isActive !== undefined) {
      update.isActive = !(update.isActive === 'false' || update.isActive === false);
    }
    if (update.isFeatured !== undefined) {
      update.isFeatured = update.isFeatured === 'true' || update.isFeatured === true;
    }
    if (update.price !== undefined) {
      update.price = Number(update.price);
      if (Number.isNaN(update.price) || update.price < 0) {
        return res.status(400).json({ message: 'Price must be a valid non-negative number.' });
      }
    }
    if (update.discountPrice !== undefined && update.discountPrice !== '') {
      update.discountPrice = Number(update.discountPrice);
      if (Number.isNaN(update.discountPrice) || update.discountPrice < 0) {
        return res.status(400).json({ message: 'Discount price must be a valid non-negative number.' });
      }
      if (update.price !== undefined && update.discountPrice > update.price) {
        return res.status(400).json({ message: 'Discount price cannot exceed the original price.' });
      }
    }
    if (update.stock !== undefined && update.stock !== '') {
      update.stock = Number(update.stock);
      if (Number.isNaN(update.stock) || update.stock < 0) {
        return res.status(400).json({ message: 'Stock must be a valid non-negative number.' });
      }
    }
    const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    cache.del(`store:item:${req.params.id}`);
    cache.delPattern('store:list');
    res.json(product);
  } catch (err) {
    sendDbError(res, err);
  }
});

// DELETE /api/store/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Product not found' });
    cache.del(`store:item:${req.params.id}`);
    cache.delPattern('store:list');
    res.json({ message: 'Product deleted' });
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/store/:id/review
router.post('/:id/review', protect, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const score = Number(rating);
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }
    // One review per user — this used to append a duplicate on every submit,
    // letting a single account drag the average rating anywhere it liked.
    const existing = product.reviews.find(r => String(r.user) === String(req.user._id));
    if (existing) {
      existing.rating = score; existing.comment = comment; existing.date = new Date();
    } else {
      product.reviews.push({ user: req.user._id, name: req.user.name, rating: score, comment });
    }
    product.reviewCount = product.reviews.length;
    product.rating = product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length;
    await product.save();
    cache.del(`store:item:${req.params.id}`);
    cache.delPattern('store:list');
    res.json(product);
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = router;
