const express = require('express');
const router = express.Router();
const {
  placeOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderInvoice,
} = require('../controllers/orders.controller');
const { protect, adminOnly } = require('../middlewares/auth.middleware');

router.post('/', protect, placeOrder);
router.get('/my', protect, getMyOrders);
router.get('/', protect, adminOnly, getAllOrders);
router.put('/:id/status', protect, adminOnly, updateOrderStatus);
router.get('/:id/invoice', protect, getOrderInvoice);

module.exports = router;
