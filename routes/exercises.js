const express = require('express');
const router = express.Router();
const Exercise = require('../models/Exercise');
const cloudinary = require('../config/cloudinary');
const { protect, trainerOrAdmin } = require('../middleware/auth');
const cache = require('../utils/cache');

// POST /api/exercises/sign-upload
// Returns a short-lived Cloudinary signature so the browser can upload
// a video/image DIRECTLY to Cloudinary, bypassing Vercel's 4.5 MB limit.
router.post('/sign-upload', protect, trainerOrAdmin, (req, res) => {
  const cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    return res.status(500).json({ message: 'Cloudinary not configured on server.' });
  }
  const { folder = 'exercises/videos', resource_type = 'video' } = req.body;
  const timestamp = Math.round(Date.now() / 1000);
  const paramsToSign = { folder, timestamp };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, cfg.api_secret);
  res.json({
    signature,
    timestamp,
    folder,
    resource_type,
    api_key: cfg.api_key,
    cloud_name: cfg.cloud_name,
  });
});

/**
 * Upload a file to Cloudinary.
 * Supports both temp-file mode (local dev) and in-memory buffer mode (Vercel).
 * Images: auto quality + format compression.
 * Videos: auto quality + 1 Mbps bitrate cap.
 *
 * Throws a descriptive Error if Cloudinary credentials are not configured
 * so the route's try/catch returns a JSON 500 instead of crashing the process.
 */
async function uploadToCloudinary(file, options = {}) {
  // Guard: check credentials are actually configured
  const cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    throw new Error(
      'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, ' +
      'CLOUDINARY_API_SECRET to your Vercel environment variables and redeploy.'
    );
  }

  // Inject compression defaults
  const isVideo = options.resource_type === 'video';
  const compressed = isVideo
    ? { quality: 'auto', video_codec: 'auto', bit_rate: '1m', ...options }
    : { quality: 'auto', fetch_format: 'auto', ...options };

  if (file.tempFilePath) {
    return cloudinary.uploader.upload(file.tempFilePath, compressed);
  }
  // In-memory buffer — use upload_stream wrapped in a Promise
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(compressed, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(file.data);
  });
}

// GET /api/exercises?muscleGroup=chest&public=true
router.get('/', async (req, res) => {
  try {
    let query = {};
    if (req.query.muscleGroup) query.muscleGroup = req.query.muscleGroup;

    const authHeader = req.headers.authorization;
    let userId = null;
    let isStaff = false;

    if (authHeader) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const User = require('../models/User');
        const user = await User.findById(decoded.id).select('role').lean();
        if (user && (user.role === 'admin' || user.role === 'trainer')) {
          isStaff = true;
        } else {
          userId = decoded.id;
          query.$or = [{ isPublic: true }, { assignedTo: decoded.id }];
        }
      } catch {
        query.isPublic = true;
      }
    } else {
      query.isPublic = true;
    }

    // Only cache public/staff list reads (not per-member personalised queries)
    const cacheKey = isStaff
      ? `exercises:staff:${req.query.muscleGroup || 'all'}`
      : !userId
        ? `exercises:public:${req.query.muscleGroup || 'all'}`
        : null;

    let exercises;
    if (cacheKey) {
      exercises = await cache.getOrSet(cacheKey, 90, () =>
        Exercise.find(query).populate('uploadedBy', 'name role').sort({ createdAt: -1 }).lean()
      );
    } else {
      exercises = await Exercise.find(query).populate('uploadedBy', 'name role').sort({ createdAt: -1 }).lean();
    }

    if (cacheKey) res.set('Cache-Control', 'public, max-age=90, stale-while-revalidate=180');
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/exercises/my -- member: only exercises assigned to them (protected)
router.get('/my', protect, async (req, res) => {
  try {
    const cacheKey = `exercises:member:${req.user._id}`;
    const exercises = await cache.getOrSet(cacheKey, 60, () =>
      Exercise.find({ assignedTo: req.user._id })
        .populate('uploadedBy', 'name role')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/exercises/:id
router.get('/:id', async (req, res) => {
  try {
    const cacheKey = `exercises:item:${req.params.id}`;
    const ex = await cache.getOrSet(cacheKey, 120, () =>
      Exercise.findById(req.params.id).populate('uploadedBy', 'name role').lean()
    );
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });
    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
    res.json(ex);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/exercises - trainer or admin uploads
router.post('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    // Support two paths:
    //  A) File uploaded via multipart (small image) → upload to Cloudinary here
    //  B) File already uploaded directly by browser → just use the URL passed in body
    let imageUrl = req.body.imageUrl || '';
    let videoUrl = req.body.uploadedVideoUrl || '';
    let videoPublicId = req.body.uploadedVideoPublicId || '';

    if (req.files?.image) {
      const result = await uploadToCloudinary(req.files.image, { folder: 'exercises' });
      imageUrl = result.secure_url;
    }
    if (req.files?.video) {
      const result = await uploadToCloudinary(req.files.video, { folder: 'exercises/videos', resource_type: 'video' });
      videoUrl = result.secure_url;
      videoPublicId = result.public_id;
    }

    const exercise = await Exercise.create({
      title:          req.body.title,
      description:    req.body.description,
      instructions:   req.body.instructions,
      muscleGroup:    req.body.muscleGroup,
      difficulty:     req.body.difficulty,
      equipmentNeeded: req.body.equipmentNeeded,
      sets:           req.body.sets,
      reps:           req.body.reps,
      duration:       req.body.duration,
      videoUrl:       req.body.videoUrl || '',
      image:          imageUrl,
      video:          videoUrl,
      videoPublicId,
      uploadedBy:     req.user._id,
      assignedTo:     req.body.assignedTo ? JSON.parse(req.body.assignedTo) : [],
      isPublic:       req.body.isPublic === 'false' ? false : true,
    });
    cache.delPattern('exercises:');
    res.status(201).json(exercise);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/exercises/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const ex = await Exercise.findById(req.params.id);
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });

    // Support browser-direct upload path: body fields take precedence over file uploads
    let imageUrl = req.body.imageUrl || ex.image;
    let videoUrl = req.body.uploadedVideoUrl || ex.video;
    let videoPublicId = req.body.uploadedVideoPublicId || ex.videoPublicId;

    if (req.files?.image) {
      const result = await uploadToCloudinary(req.files.image, { folder: 'exercises' });
      imageUrl = result.secure_url;
    }
    if (req.files?.video) {
      if (videoPublicId) {
        await cloudinary.uploader.destroy(videoPublicId, { resource_type: 'video' }).catch(() => {});
      }
      const result = await uploadToCloudinary(req.files.video, { folder: 'exercises/videos', resource_type: 'video' });
      videoUrl = result.secure_url;
      videoPublicId = result.public_id;
    }

    const updates = {
      title:          req.body.title          || ex.title,
      description:    req.body.description    ?? ex.description,
      instructions:   req.body.instructions   ?? ex.instructions,
      muscleGroup:    req.body.muscleGroup     || ex.muscleGroup,
      difficulty:     req.body.difficulty      || ex.difficulty,
      equipmentNeeded: req.body.equipmentNeeded ?? ex.equipmentNeeded,
      sets:           req.body.sets           ?? ex.sets,
      reps:           req.body.reps           ?? ex.reps,
      duration:       req.body.duration       ?? ex.duration,
      videoUrl:       req.body.videoUrl       !== undefined ? req.body.videoUrl : ex.videoUrl,
      image:          imageUrl,
      video:          videoUrl,
      videoPublicId,
      assignedTo:     req.body.assignedTo ? JSON.parse(req.body.assignedTo) : ex.assignedTo,
      isPublic:       req.body.isPublic === 'false' ? false : req.body.isPublic === 'true' ? true : ex.isPublic,
    };
    const updated = await Exercise.findByIdAndUpdate(req.params.id, updates, { new: true });
    cache.del(`exercises:item:${req.params.id}`);
    cache.delPattern('exercises:staff');
    cache.delPattern('exercises:public');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/exercises/:id
router.delete('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const ex = await Exercise.findById(req.params.id);
    if (!ex) return res.status(404).json({ message: 'Not found' });
    if (ex.videoPublicId) {
      await cloudinary.uploader.destroy(ex.videoPublicId, { resource_type: 'video' });
    }
    await ex.deleteOne();
    cache.del(`exercises:item:${req.params.id}`);
    cache.delPattern('exercises:staff');
    cache.delPattern('exercises:public');
    res.json({ message: 'Exercise deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
