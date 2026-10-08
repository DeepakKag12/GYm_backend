const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  addProductReview,
} = require('../controllers/store.controller');
const { protect, adminOnly } = require('../middlewares/auth.middleware');
const { publicCache } = require('../middlewares/publicCache.middleware');

router.get('/', publicCache(60), getProducts);
router.get('/:id', publicCache(120), getProductById);
router.post('/', protect, adminOnly, createProduct);
router.put('/:id', protect, adminOnly, updateProduct);
router.delete('/:id', protect, adminOnly, deleteProduct);
router.post('/:id/review', protect, addProductReview);

module.exports = router;
