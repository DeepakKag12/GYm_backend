const path = require('path');
const fs = require('fs');
const SiteSettings = require('../models/SiteSettings.model');
const cloudinary = require('../config/cloudinary');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { sendDbError } = require('../utils/dbError');

const CACHE_KEY = 'site:settings';

function present(doc) {
  return {
    gymName: doc.gymName,
    ownerName: doc.ownerName,
    tagline: doc.tagline,
    phone: doc.phone,
    whatsapp: doc.whatsapp || doc.phone,
    email: doc.email,
    instagram: doc.instagram,
    address: doc.address,
    upiId: doc.upiId || '',
    hours: doc.hours || [],
    heroWorkoutImage: doc.heroWorkoutImage || '',
    heroJoinImage: doc.heroJoinImage || '',
    ctaBannerImage: doc.ctaBannerImage || '',
    updatedAt: doc.updatedAt,
  };
}

// GET /api/settings
const getSettings = asyncHandler(async (req, res) => {
  try {
    const data = await cache.getOrSet(CACHE_KEY, 300, async () => {
      const doc = await SiteSettings.getSettings();
      return present(doc);
    });
    res.json(data);
  } catch (err) { sendDbError(res, err, 'Could not load the gym details.'); }
});

// POST /api/settings/upload-image
const uploadImage = asyncHandler(async (req, res) => {
  try {
    if (!req.files || !req.files.image) {
      return res.status(400).json({ message: 'No image file uploaded.' });
    }
    const file = req.files.image;
    const ext = path.extname(file.name || '').toLowerCase();
    const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif'];
    if (!ALLOWED_EXTS.includes(ext)) {
      return res.status(400).json({ message: 'Only image files (.jpg, .jpeg, .png, .webp, .svg, .gif) are allowed.' });
    }

    const cfg = cloudinary.config();
    if (cfg.cloud_name && cfg.api_key && cfg.api_secret) {
      const opts = { folder: 'settings', quality: 'auto', fetch_format: 'auto' };
      let result;
      if (file.tempFilePath) {
        result = await cloudinary.uploader.upload(file.tempFilePath, opts);
      } else if (file.data) {
        result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(opts, (err, r) => err ? reject(err) : resolve(r));
          stream.end(file.data);
        });
      }
      if (result?.secure_url) {
        return res.json({ url: result.secure_url, message: 'Image uploaded successfully.' });
      }
    }

    const uploadDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const filename = `hero-${Date.now()}-${Math.round(Math.random() * 1e4)}${ext}`;
    const targetPath = path.join(uploadDir, filename);

    if (file.mv) {
      await file.mv(targetPath);
    } else if (file.data) {
      fs.writeFileSync(targetPath, file.data);
    } else {
      return res.status(500).json({ message: 'Unable to save uploaded file.' });
    }

    const fileUrl = `/uploads/${filename}`;
    res.json({ url: fileUrl, message: 'Image uploaded successfully.' });
  } catch (err) {
    sendDbError(res, err, 'Could not upload image.');
  }
});

// PUT /api/settings
const updateSettings = asyncHandler(async (req, res) => {
  try {
    const ALLOWED = [
      'gymName', 'ownerName', 'tagline',
      'phone', 'whatsapp', 'email', 'instagram', 'address', 'upiId',
      'heroWorkoutImage', 'heroJoinImage', 'ctaBannerImage',
    ];

    const doc = await SiteSettings.getSettings();
    for (const field of ALLOWED) {
      if (req.body[field] !== undefined) doc[field] = String(req.body[field]).trim();
    }

    if (req.body.hours !== undefined) {
      const lines = Array.isArray(req.body.hours)
        ? req.body.hours
        : String(req.body.hours).split('\n');
      doc.hours = lines.map(l => String(l).trim()).filter(Boolean).slice(0, 6);
    }

    if (!doc.gymName) return res.status(400).json({ message: 'The gym needs a name.' });
    if (!doc.phone)   return res.status(400).json({ message: 'A contact phone number is required.' });

    doc.updatedBy = req.user._id;
    await doc.save();

    cache.del(CACHE_KEY);

    res.json({ message: 'Gym details updated.', settings: present(doc) });
  } catch (err) { sendDbError(res, err, 'Could not save the gym details.'); }
});

module.exports = {
  getSettings,
  uploadImage,
  updateSettings,
};
