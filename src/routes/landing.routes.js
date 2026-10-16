const express = require('express');
const router = express.Router();
const {
  getLandingConfig,
  updateLandingConfig,
} = require('../controllers/landing.controller');
const { protect, adminOnly } = require('../middlewares/auth.middleware');
const { publicCache } = require('../middlewares/publicCache.middleware');

router.get('/', publicCache(120), getLandingConfig);
router.put('/', protect, adminOnly, updateLandingConfig);

module.exports = router;
