const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const Order   = require('../models/Order');
const Exercise = require('../models/Exercise');
const DietPlan = require('../models/DietPlan');
const { protect, adminOnly } = require('../middleware/auth');
const cache   = require('../utils/cache');

// ─── helpers ────────────────────────────────────────────────────────────────
function monthStart(offsetFromNow = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetFromNow);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── GET /api/analytics/summary ─────────────────────────────────────────────
router.get('/summary', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:summary', 120, async () => {
      const now = new Date();
      const thisMonthStart = monthStart(0);
      const lastMonthStart = monthStart(-1);

      const [totalMembers, activeMembers, expiredMembers, pendingMembers, orders, totalExercises, totalDietPlans, totalTrainers] = await Promise.all([
        User.countDocuments({ role: 'member' }),
        User.countDocuments({ role: 'member', membershipStatus: 'active' }),
        User.countDocuments({ role: 'member', membershipStatus: 'expired' }),
        User.countDocuments({ role: 'member', membershipStatus: 'pending' }),
        Order.find({}).lean(),
        Exercise.countDocuments({}),
        DietPlan.countDocuments({}),
        User.countDocuments({ role: 'trainer' }),
      ]);

      const expiringIn7 = await User.countDocuments({
        role: 'member',
        membershipEnd: { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) },
      });

      const paidOrders      = orders.filter(o => o.paymentStatus === 'paid');
      const revenue         = paidOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
      const monthlyRevenue  = paidOrders.filter(o => new Date(o.createdAt) >= thisMonthStart)
                                        .reduce((s, o) => s + (o.totalAmount || 0), 0);
      const lastMonthRevenue = paidOrders.filter(o => {
        const d = new Date(o.createdAt);
        return d >= lastMonthStart && d < thisMonthStart;
      }).reduce((s, o) => s + (o.totalAmount || 0), 0);

      const membershipFeeRevenue = await User.aggregate([
        { $match: { role: 'member', feePaid: true } },
        { $group: { _id: null, total: { $sum: '$feeAmount' } } },
      ]);
      const membershipRevenue = membershipFeeRevenue[0]?.total || 0;

      const pendingFeeResult = await User.aggregate([
        { $match: { role: 'member', feePaid: false, membershipStatus: 'active' } },
        { $group: { _id: null, total: { $sum: '$feeAmount' }, count: { $sum: 1 } } },
      ]);
      const pendingFees     = pendingFeeResult[0]?.total || 0;
      const pendingFeeCount = pendingFeeResult[0]?.count || 0;

      return {
        totalMembers, activeMembers, expiredMembers, pendingMembers,
        expiringIn7,
        totalOrders: orders.length,
        totalExercises,
        totalDietPlans,
        totalTrainers,
        revenue,
        monthlyRevenue,
        lastMonthRevenue,
        membershipRevenue,
        pendingFees,
        pendingFeeCount,
      };
    });
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/revenue-monthly ─────────────────────────────────────
router.get('/revenue-monthly', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:revenue-monthly', 180, async () => {
      const sixMonthsAgo = monthStart(-5);
      return Order.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo }, paymentStatus: 'paid' } },
        { $group: {
            _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            revenue: { $sum: '$totalAmount' },
            orders:  { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]);
    });
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/membership-stats ────────────────────────────────────
router.get('/membership-stats', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:membership-stats', 180, () =>
      User.aggregate([
        { $match: { role: 'member' } },
        { $group: { _id: '$membershipPlan', count: { $sum: 1 }, revenue: { $sum: '$feeAmount' } } },
      ])
    );
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/new-members-monthly ─────────────────────────────────
router.get('/new-members-monthly', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:new-members-monthly', 180, async () => {
      const sixMonthsAgo = monthStart(-5);
      return User.aggregate([
        { $match: { role: 'member', createdAt: { $gte: sixMonthsAgo } } },
        { $group: {
            _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 },
            fees:  { $sum: '$feeAmount' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]);
    });
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/revenue-full ────────────────────────────────────────
// Comprehensive revenue breakdown: membership fees + store orders, by month (12 months)
router.get('/revenue-full', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:revenue-full', 180, async () => {
    const twelveMonthsAgo = monthStart(-11);
    const now = new Date();

    // Store order revenue by month
    const ordersByMonth = await Order.aggregate([
      { $match: { createdAt: { $gte: twelveMonthsAgo }, paymentStatus: 'paid' } },
      { $group: {
          _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          storeRevenue: { $sum: '$totalAmount' },
          orderCount:   { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Membership fee revenue by month (based on membershipStart)
    const membershipByMonth = await User.aggregate([
      { $match: { role: 'member', feePaid: true, membershipStart: { $gte: twelveMonthsAgo } } },
      { $group: {
          _id:               { year: { $year: '$membershipStart' }, month: { $month: '$membershipStart' } },
          membershipRevenue: { $sum: '$feeAmount' },
          memberCount:       { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Merge into a single array covering last 12 months
    const months = [];
    for (let i = -11; i <= 0; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const yr = d.getFullYear(), mo = d.getMonth() + 1;
      const o = ordersByMonth.find(x => x._id.year === yr && x._id.month === mo) || {};
      const m = membershipByMonth.find(x => x._id.year === yr && x._id.month === mo) || {};
      months.push({
        year: yr, month: mo,
        storeRevenue:      o.storeRevenue      || 0,
        orderCount:        o.orderCount        || 0,
        membershipRevenue: m.membershipRevenue || 0,
        memberCount:       m.memberCount       || 0,
        totalRevenue:      (o.storeRevenue || 0) + (m.membershipRevenue || 0),
      });
    }

    // Plan-wise fee breakdown
    const planBreakdown = await User.aggregate([
      { $match: { role: 'member', feePaid: true } },
      { $group: {
          _id:     '$membershipPlan',
          revenue: { $sum: '$feeAmount' },
          count:   { $sum: 1 },
        },
      },
    ]);

    // Payment method breakdown from orders
    const paymentMethodBreakdown = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: {
          _id:     '$paymentMethod',
          revenue: { $sum: '$totalAmount' },
          count:   { $sum: 1 },
        },
      },
    ]);

    // Top selling products
    const topProducts = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $unwind: '$items' },
      { $group: {
          _id:      '$items.name',
          revenue:  { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          units:    { $sum: '$items.quantity' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]);

    // Members with pending fees
    const pendingFeeMembers = await User.find({
      role: 'member', feePaid: false, membershipStatus: 'active',
    }).select('name phone membershipPlan feeAmount membershipEnd').lean();

    // Totals
    const totalMembershipRevenue = planBreakdown.reduce((s, p) => s + p.revenue, 0);
    const totalStoreRevenue      = paymentMethodBreakdown.reduce((s, p) => s + p.revenue, 0);
    const totalPendingFees       = pendingFeeMembers.reduce((s, m) => s + (m.feeAmount || 0), 0);

    return {
      months,
      planBreakdown,
      paymentMethodBreakdown,
      topProducts,
      pendingFeeMembers,
      totals: {
        membershipRevenue: totalMembershipRevenue,
        storeRevenue:      totalStoreRevenue,
        totalRevenue:      totalMembershipRevenue + totalStoreRevenue,
        pendingFees:       totalPendingFees,
        pendingFeeCount:   pendingFeeMembers.length,
      },
    };
    }); // end cache.getOrSet
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
