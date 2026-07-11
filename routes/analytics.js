const express = require('express');
const router = express.Router();
const User  = require('../models/User');
const Order = require('../models/Order');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/analytics/summary  - admin dashboard stats
router.get('/summary', protect, adminOnly, async (req, res) => {
  try {
    const [totalMembers, activeMembers, orders, expiredMembers] = await Promise.all([
      User.countDocuments({ role: 'member' }),
      User.countDocuments({ role: 'member', membershipStatus: 'active' }),
      Order.find({}),
      User.countDocuments({ role: 'member', membershipStatus: 'expired' }),
    ]);

    const now = new Date();
    const expiringIn7 = await User.countDocuments({
      role: 'member',
      membershipEnd: { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) }
    });

    const revenue = orders
      .filter(o => o.paymentStatus === 'paid')
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyRevenue = orders
      .filter(o => o.paymentStatus === 'paid' && new Date(o.createdAt) >= thisMonthStart)
      .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    res.json({ totalMembers, activeMembers, expiredMembers, expiringIn7, totalOrders: orders.length, revenue, monthlyRevenue });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/revenue-monthly  - last 6 months revenue breakdown
router.get('/revenue-monthly', protect, adminOnly, async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const data = await Order.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo }, paymentStatus: 'paid' } },
      { $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          revenue: { $sum: '$totalAmount' },
          orders:  { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/membership-stats  - plan-wise member count
router.get('/membership-stats', protect, adminOnly, async (req, res) => {
  try {
    const data = await User.aggregate([
      { $match: { role: 'member' } },
      { $group: { _id: '$membershipPlan', count: { $sum: 1 } } }
    ]);
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/analytics/new-members-monthly  - new sign-ups per month (last 6)
router.get('/new-members-monthly', protect, adminOnly, async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const data = await User.aggregate([
      { $match: { role: 'member', createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
