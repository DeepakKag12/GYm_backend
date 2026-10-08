const express = require('express');
const router = express.Router();
const { protect, trainerOrAdmin } = require('../middlewares/auth.middleware');
const {
  getMySplit,
  getPlanner,
  savePlanner,
  getAllSplits,
  createSplit,
  updateSplit,
  deleteSplit,
} = require('../controllers/splits.controller');

// Member assigned and personal planner splits
router.get('/me', protect, getMySplit);
router.get('/planner', protect, getPlanner);
router.put('/planner', protect, savePlanner);

// Trainer & Admin management
router.get('/', protect, trainerOrAdmin, getAllSplits);
router.post('/', protect, trainerOrAdmin, createSplit);
router.put('/:id', protect, trainerOrAdmin, updateSplit);
router.delete('/:id', protect, trainerOrAdmin, deleteSplit);

module.exports = router;
