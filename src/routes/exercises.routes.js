const express = require('express');
const router = express.Router();
const { protect, trainerOrAdmin } = require('../middlewares/auth.middleware');
const { publicCache } = require('../middlewares/publicCache.middleware');
const {
  signUpload,
  getAllExercises,
  getMyExercises,
  getExerciseById,
  createExercise,
  updateExercise,
  deleteExercise,
} = require('../controllers/exercises.controller');

// Direct upload signature
router.post('/sign-upload', protect, trainerOrAdmin, signUpload);

// Public / query listing
router.get('/', publicCache(60), getAllExercises);

// Member assigned exercises
router.get('/my', protect, getMyExercises);

// Exercise details by id
router.get('/:id', getExerciseById);

// Staff management
router.post('/', protect, trainerOrAdmin, createExercise);
router.put('/:id', protect, trainerOrAdmin, updateExercise);
router.delete('/:id', protect, trainerOrAdmin, deleteExercise);

module.exports = router;
