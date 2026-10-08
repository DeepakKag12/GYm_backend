const express = require('express');
const router = express.Router();
const { protect, trainerOrAdmin } = require('../middlewares/auth.middleware');
const {
  getMyProgress,
  getMemberProgress,
  createProgressEntry,
  deleteProgressEntry,
} = require('../controllers/progress.controller');

router.get('/', protect, getMyProgress);
router.get('/me', protect, getMyProgress);
router.get('/:memberId', protect, trainerOrAdmin, getMemberProgress);
router.post('/', protect, createProgressEntry);
router.delete('/:id', protect, deleteProgressEntry);

module.exports = router;
