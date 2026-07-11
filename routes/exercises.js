const express = require('express');
const router = express.Router();
const Exercise = require('../models/Exercise');
const cloudinary = require('../config/cloudinary');
const { protect, trainerOrAdmin } = require('../middleware/auth');

// GET /api/exercises?muscleGroup=chest&public=true
router.get('/', async (req, res) => {
  try {
    let query = {};
    if (req.query.muscleGroup) query.muscleGroup = req.query.muscleGroup;
    // For public view, show only public exercises
    // Authenticated members also see exercises assigned to them
    const authHeader = req.headers.authorization;
    if (authHeader) {
      // decode without error check to get userId
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const User = require('../models/User');
        const user = await User.findById(decoded.id);
        if (user && (user.role === 'admin' || user.role === 'trainer')) {
          // trainers/admin see all
        } else {
          query.$or = [{ isPublic: true }, { assignedTo: decoded.id }];
        }
      } catch {
        query.isPublic = true;
      }
    } else {
      query.isPublic = true;
    }
    const exercises = await Exercise.find(query)
      .populate('uploadedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/exercises/my -- member: only exercises assigned to them (protected)
router.get('/my', protect, async (req, res) => {
  try {
    const exercises = await Exercise.find({ assignedTo: req.user._id })
      .populate('uploadedBy', 'name role')
      .sort({ createdAt: -1 });
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/exercises/:id
router.get('/:id', async (req, res) => {
  try {
    const ex = await Exercise.findById(req.params.id).populate('uploadedBy', 'name role');
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });
    res.json(ex);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/exercises - trainer or admin uploads
router.post('/', protect, trainerOrAdmin, async (req, res) => {
  try {
    let imageUrl = '', videoUrl = '', videoPublicId = '';

    if (req.files?.image) {
      const result = await cloudinary.uploader.upload(req.files.image.tempFilePath, { folder: 'exercises' });
      imageUrl = result.secure_url;
    }
    if (req.files?.video) {
      const result = await cloudinary.uploader.upload(req.files.video.tempFilePath, {
        folder: 'exercises/videos', resource_type: 'video'
      });
      videoUrl = result.secure_url;
      videoPublicId = result.public_id;
    }

    const exercise = await Exercise.create({
      ...req.body,
      image: imageUrl,
      video: videoUrl,
      videoPublicId,
      uploadedBy: req.user._id,
      assignedTo: req.body.assignedTo ? JSON.parse(req.body.assignedTo) : [],
      isPublic: req.body.isPublic === 'false' ? false : true,
    });
    res.status(201).json(exercise);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/exercises/:id
router.put('/:id', protect, trainerOrAdmin, async (req, res) => {
  try {
    const ex = await Exercise.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!ex) return res.status(404).json({ message: 'Exercise not found' });
    res.json(ex);
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
    res.json({ message: 'Exercise deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
