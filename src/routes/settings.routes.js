const express = require('express');
const router = express.Router();
const {
  getSettings,
  uploadImage,
  updateSettings,
} = require('../controllers/settings.controller');
const { protect, adminOnly } = require('../middlewares/auth.middleware');

router.get('/', getSettings);
router.post('/upload-image', protect, adminOnly, uploadImage);
router.put('/', protect, adminOnly, updateSettings);

module.exports = router;
