const Transformation = require('../models/Transformation.model');
const cloudinary = require('../config/cloudinary');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');
const { asyncHandler } = require('../utils/asyncHandler');

async function uploadMedia(file, folder = 'transformations', resourceType = 'image') {
  const cfg = cloudinary.config();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    throw new Error(
      'Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, ' +
      'CLOUDINARY_API_SECRET to your Vercel environment variables and redeploy.'
    );
  }
  const opts = { folder, resource_type: resourceType };
  if (resourceType === 'image') {
    opts.quality = 'auto';
    opts.fetch_format = 'auto';
  }
  if (file.tempFilePath) return cloudinary.uploader.upload(file.tempFilePath, opts);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(opts, (err, r) => err ? reject(err) : resolve(r));
    stream.end(file.data);
  });
}

// GET /api/transformations (public)
const getPublicTransformations = asyncHandler(async (req, res) => {
  try {
    const transformations = await cache.getOrSet('transformations:public', 120, () =>
      Transformation.find({ isPublic: true })
        .populate('member', 'name avatar')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(transformations);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/transformations/all (admin/trainer)
const getAllTransformations = asyncHandler(async (req, res) => {
  try {
    const transformations = await cache.getOrSet('transformations:all', 60, () =>
      Transformation.find()
        .populate('member', 'name avatar')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(transformations);
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/transformations
const createTransformation = asyncHandler(async (req, res) => {
  try {
    let beforeImage = '', afterImage = '', video = '';
    if (req.files?.beforeImage) {
      const r = await uploadMedia(req.files.beforeImage, 'transformations', 'image');
      beforeImage = r.secure_url;
    }
    if (req.files?.afterImage) {
      const r = await uploadMedia(req.files.afterImage, 'transformations', 'image');
      afterImage = r.secure_url;
    }
    if (req.files?.video) {
      const r = await uploadMedia(req.files.video, 'transformations/videos', 'video');
      video = r.secure_url;
    }
    const transformation = await Transformation.create({
      ...req.body,
      beforeImage, afterImage, video,
      videoUrl: req.body.videoUrl || '',
      uploadedBy: req.user._id,
      isPublic: req.body.isPublic === 'false' ? false : true,
    });
    cache.delPattern('transformations:');
    res.status(201).json(transformation);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/transformations/:id
const updateTransformation = asyncHandler(async (req, res) => {
  try {
    const t = await Transformation.findById(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });

    let beforeImage = t.beforeImage;
    let afterImage  = t.afterImage;
    let video       = t.video || '';

    if (req.files?.beforeImage) {
      const r = await uploadMedia(req.files.beforeImage, 'transformations', 'image');
      beforeImage = r.secure_url;
    }
    if (req.files?.afterImage) {
      const r = await uploadMedia(req.files.afterImage, 'transformations', 'image');
      afterImage = r.secure_url;
    }
    if (req.files?.video) {
      const r = await uploadMedia(req.files.video, 'transformations/videos', 'video');
      video = r.secure_url;
    }

    const updated = await Transformation.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        beforeImage,
        afterImage,
        video,
        videoUrl: req.body.videoUrl !== undefined ? req.body.videoUrl : t.videoUrl,
        isPublic: req.body.isPublic === 'false' ? false : req.body.isPublic === 'true' ? true : t.isPublic,
      },
      { new: true }
    );
    cache.delPattern('transformations:');
    res.json(updated);
  } catch (err) {
    sendDbError(res, err);
  }
});

// DELETE /api/transformations/:id
const deleteTransformation = asyncHandler(async (req, res) => {
  try {
    await Transformation.findByIdAndDelete(req.params.id);
    cache.delPattern('transformations:');
    res.json({ message: 'Deleted' });
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = {
  getPublicTransformations,
  getAllTransformations,
  createTransformation,
  updateTransformation,
  deleteTransformation,
};
