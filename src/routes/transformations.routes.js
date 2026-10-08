const express = require('express');
const router = express.Router();
const { protect, trainerOrAdmin } = require('../middlewares/auth.middleware');
const { publicCache } = require('../middlewares/publicCache.middleware');
const {
  getPublicTransformations,
  getAllTransformations,
  createTransformation,
  updateTransformation,
  deleteTransformation,
} = require('../controllers/transformations.controller');

// Public gallery with caching
router.get('/', publicCache(60), getPublicTransformations);

// Admin & Trainer management
router.get('/all', protect, trainerOrAdmin, getAllTransformations);
router.post('/', protect, trainerOrAdmin, createTransformation);
router.put('/:id', protect, trainerOrAdmin, updateTransformation);
router.delete('/:id', protect, trainerOrAdmin, deleteTransformation);

module.exports = router;
