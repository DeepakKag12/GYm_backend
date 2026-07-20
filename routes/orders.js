const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');

// POST /api/orders - Place order
router.post('/', protect, async (req, res) => {
  try {
    const order = await Order.create({ ...req.body, user: req.user._id });
    // Invalidate analytics + this member's orders cache
    cache.delPattern('analytics:');
    cache.del(`orders:member:${req.user._id}`);
    cache.del('orders:admin');
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/orders/my - User's own orders
router.get('/my', protect, async (req, res) => {
  try {
    const key = `orders:member:${req.user._id}`;
    const orders = await cache.getOrSet(key, 60, () =>
      Order.find({ user: req.user._id }).sort({ createdAt: -1 }).lean()
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/orders - Admin: all orders
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const orders = await cache.getOrSet('orders:admin', 60, () =>
      Order.find().populate('user', 'name email phone').sort({ createdAt: -1 }).lean()
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/orders/:id/status - Admin updates status
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const update = {};
    if (req.body.orderStatus  !== undefined) update.orderStatus  = req.body.orderStatus;
    if (req.body.paymentStatus !== undefined) update.paymentStatus = req.body.paymentStatus;
    const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
    cache.delPattern('analytics:');
    cache.del('orders:admin');
    // Bust the individual member's order cache too
    if (order?.user) cache.del(`orders:member:${order.user}`);
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
