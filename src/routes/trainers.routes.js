const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middlewares/auth.middleware');
const {
  getAllTrainers,
  createTrainer,
  updateTrainer,
  deleteTrainer,
} = require('../controllers/trainers.controller');

// Public route to get trainers (or admin query ?all=1)
router.get('/', getAllTrainers);

// Admin-only management
router.post('/', protect, adminOnly, createTrainer);
router.put('/:id', protect, adminOnly, updateTrainer);
router.delete('/:id', protect, adminOnly, deleteTrainer);

module.exports = router;
