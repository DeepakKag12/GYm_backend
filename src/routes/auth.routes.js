const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const {
  register,
  login,
  getMe,
  updateProfile,
  updateCredentials,
} = require('../controllers/auth.controller');

// Public auth routes
router.post('/register', register);
router.post('/login', login);

// Authenticated user routes
router.get('/me', protect, getMe);
router.put('/update-profile', protect, updateProfile);
router.put('/update-credentials', protect, updateCredentials);

module.exports = router;
