const jwt = require('jsonwebtoken');
const Exercise = require('../models/Exercise.model');
const User = require('../models/User.model');
const cloudinary = require('../config/cloudinary');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');
const { asyncHandler } = require('../utils/asyncHandler');

// Helper: signature for direct client upload
const signUpload = asyncHandler(async (req, res) => {
  const cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    return res.status(500).json({ message: 'Cloudinary not configured on server.' });
  }

  const { folder = 'exercises/videos', resource_type = 'video' } = req.body;
  const paramsToSign = { folder, timestamp: Math.round(Date.now() / 1000) };

  if (resource_type === 'video') {
    paramsToSign.quality = 'auto';
    paramsToSign.video_codec = 'auto';
  }

  const signature = cloudinary.utils.api_sign_request(paramsToSign, cfg.api_secret);

  res.json({
    signature,
    params: paramsToSign,
    timestamp: paramsToSign.timestamp,
    folder,
    resource_type,
    api_key: cfg.api_key,
    cloud_name: cfg.cloud_name,
  });
});

async function uploadToCloudinary(file, options = {}) {
  const cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    throw new Error(
      'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, ' +
      'CLOUDINARY_API_SECRET to your Vercel environment variables and redeploy.'
    );
  }

  const isVideo = options.resource_type === 'video';
  const compressed = isVideo
    ? { quality: 'auto', video_codec: 'auto', bit_rate: '1m', ...options }
    : { quality: 'auto', fetch_format: 'auto', ...options };

  if (file.tempFilePath) {
    return cloudinary.uploader.upload(file.tempFilePath, compressed);
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(compressed, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(file.data);
  });
}

function safeParseArray(val, fallback = []) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

// GET /api/exercises
const getAllExercises = asyncHandler(async (req, res) => {
  try {
    let query = {};
    if (req.query.muscleGroup) query.muscleGroup = req.query.muscleGroup;

    const authHeader = req.headers.authorization;
    let userId = null;
    let isStaff = false;

    if (authHeader) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
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

    res.json(exercises);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/exercises/my
const getMyExercises = asyncHandler(async (req, res) => {
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
    sendDbError(res, err);
  }
});

// GET /api/exercises/:id
const getExerciseById = asyncHandler(async (req, res) => {
  try {
    const ex = await Exercise.findById(req.params.id).populate('uploadedBy', 'name role').lean();
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });

    if (!ex.isPublic) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ message: 'Authentication required to view private exercise.' });
      }
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('role').lean();
        if (!user) return res.status(401).json({ message: 'User not found.' });

        const isStaff = user.role === 'admin' || user.role === 'trainer';
        const isAssigned = Array.isArray(ex.assignedTo) && ex.assignedTo.some(id => String(id) === String(user._id));
        if (!isStaff && !isAssigned) {
          return res.status(403).json({ message: 'Access denied to private exercise.' });
        }
      } catch {
        return res.status(401).json({ message: 'Invalid or expired authentication token.' });
      }
    } else {
      res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=240');
    }

    res.json(ex);
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/exercises
const createExercise = asyncHandler(async (req, res) => {
  try {
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
      assignedTo:     safeParseArray(req.body.assignedTo),
      isPublic:       req.body.isPublic === 'false' ? false : true,
    });
    cache.delPattern('exercises:');
    res.status(201).json(exercise);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/exercises/:id
const updateExercise = asyncHandler(async (req, res) => {
  try {
    const ex = await Exercise.findById(req.params.id);
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });

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
      assignedTo:     req.body.assignedTo !== undefined ? safeParseArray(req.body.assignedTo, ex.assignedTo) : ex.assignedTo,
      isPublic:       req.body.isPublic === 'false' ? false : req.body.isPublic === 'true' ? true : ex.isPublic,
    };
    const updated = await Exercise.findByIdAndUpdate(req.params.id, updates, { new: true });
    cache.del(`exercises:item:${req.params.id}`);
    cache.delPattern('exercises:staff');
    cache.delPattern('exercises:public');
    res.json(updated);
  } catch (err) {
    sendDbError(res, err);
  }
});

// DELETE /api/exercises/:id
const deleteExercise = asyncHandler(async (req, res) => {
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
    sendDbError(res, err);
  }
});

module.exports = {
  signUpload,
  getAllExercises,
  getMyExercises,
  getExerciseById,
  createExercise,
  updateExercise,
  deleteExercise,
};
