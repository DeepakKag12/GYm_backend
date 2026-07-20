const express        = require('express');
const router         = express.Router();
const User           = require('../models/User');
const Order          = require('../models/Order');
const Exercise       = require('../models/Exercise');
const DietPlan       = require('../models/DietPlan');
const Notification   = require('../models/Notification');
const ProgressEntry  = require('../models/ProgressEntry');
const Enquiry        = require('../models/Enquiry');
const Transformation = require('../models/Transformation');
const { protect, adminOnly } = require('../middleware/auth');
const cache          = require('../utils/cache');

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
    const data = await cache.getOrSet('analytics:summary', 30, async () => {
      const now = new Date();
      const thisMonthStart = monthStart(0);
      const lastMonthStart = monthStart(-1);

      const [
        totalMembers, activeMembers, expiredMembers, pendingMembers,
        totalOrders, totalExercises, totalDietPlans, totalTrainers,
        revenueAgg, monthlyRevenueAgg, lastMonthRevenueAgg,
      ] = await Promise.all([
        User.countDocuments({ role: 'member' }),
        User.countDocuments({ role: 'member', membershipStatus: 'active' }),
        User.countDocuments({ role: 'member', membershipStatus: 'expired' }),
        User.countDocuments({ role: 'member', membershipStatus: 'pending' }),
        Order.countDocuments({}),
        Exercise.countDocuments({}),
        DietPlan.countDocuments({}),
        User.countDocuments({ role: 'trainer' }),
        // Total revenue from all paid orders
        Order.aggregate([
          { $match: { paymentStatus: 'paid' } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ]),
        // This month revenue
        Order.aggregate([
          { $match: { paymentStatus: 'paid', createdAt: { $gte: thisMonthStart } } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ]),
        // Last month revenue
        Order.aggregate([
          { $match: { paymentStatus: 'paid', createdAt: { $gte: lastMonthStart, $lt: thisMonthStart } } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ]),
      ]);

      const expiringIn7 = await User.countDocuments({
        role: 'member',
        membershipEnd: { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) },
      });

      const revenue          = revenueAgg[0]?.total          || 0;
      const monthlyRevenue   = monthlyRevenueAgg[0]?.total   || 0;
      const lastMonthRevenue = lastMonthRevenueAgg[0]?.total || 0;

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
        totalOrders,
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
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/revenue-monthly ─────────────────────────────────────
router.get('/revenue-monthly', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:revenue-monthly', 30, async () => {
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
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/membership-stats ────────────────────────────────────
router.get('/membership-stats', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:membership-stats', 30, () =>
      User.aggregate([
        { $match: { role: 'member' } },
        { $group: { _id: '$membershipPlan', count: { $sum: 1 }, revenue: { $sum: '$feeAmount' } } },
      ])
    );
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/new-members-monthly ─────────────────────────────────
router.get('/new-members-monthly', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:new-members-monthly', 30, async () => {
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
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/analytics/revenue-full ────────────────────────────────────────
// Comprehensive revenue breakdown: membership fees + store orders, by month (12 months)
router.get('/revenue-full', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:revenue-full', 30, async () => {
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
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── POST /api/analytics/cache-bust ─────────────────────────────────────────
// Admin: manually bust all analytics + related caches so next request is fresh
router.post('/cache-bust', protect, adminOnly, (req, res) => {
  cache.delPattern('analytics:');
  cache.delPattern('members:');
  cache.delPattern('orders:');
  res.json({ message: 'Cache cleared. Next page load will fetch fresh data.' });
});

// ─── POST /api/analytics/reset-to-production ─────────────────────────────────
// Admin: full production reset — wipes ALL transactional data.
// Deletes: ALL members, ALL orders, ALL notifications, ALL progress entries,
//          ALL enquiries, ALL transformations.
// Keeps:   admin user, trainers, membership plans, exercises (with videos),
//          diet plans, workout splits, products — these are config/content.
router.post('/reset-to-production', protect, adminOnly, async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'RESET_TO_PRODUCTION') {
      return res.status(400).json({
        message: 'Send { confirm: "RESET_TO_PRODUCTION" } in the request body to confirm.',
      });
    }

    // Run all deletes in parallel — no scoping by email, wipes every record
    const [
      membersDeleted,
      ordersDeleted,
      notifsDeleted,
      progressDeleted,
      enquiriesDeleted,
      transformsDeleted,
    ] = await Promise.all([
      User.deleteMany({ role: 'member' }).then(r => r.deletedCount),
      Order.deleteMany({}).then(r => r.deletedCount),
      Notification.deleteMany({}).then(r => r.deletedCount),
      ProgressEntry.deleteMany({}).then(r => r.deletedCount),
      Enquiry.deleteMany({}).then(r => r.deletedCount),
      Transformation.deleteMany({}).then(r => r.deletedCount),
    ]);

    // Bust every cache key
    cache.delPattern('analytics:');
    cache.delPattern('members:');
    cache.delPattern('orders:');
    cache.delPattern('notifications:');
    cache.delPattern('enquiries:');

    res.json({
      message: 'Production reset complete. Ready to add real data.',
      kept: 'Admin, trainers, membership plans, exercises, diet plans, workout splits, products',
      deleted: {
        members:         membersDeleted,
        orders:          ordersDeleted,
        notifications:   notifsDeleted,
        progressEntries: progressDeleted,
        enquiries:       enquiriesDeleted,
        transformations: transformsDeleted,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/analytics/clear-fake-data ─────────────────────────────────────
// Legacy alias → now calls the full reset under the hood (same behaviour, stricter).
// Kept for backwards compat with any existing calls from the frontend.
router.post('/clear-fake-data', protect, adminOnly, async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== 'DELETE_FAKE_DATA') {
      return res.status(400).json({
        message: 'Send { confirm: "DELETE_FAKE_DATA" } in the request body to confirm.',
      });
    }
    // Re-use the production reset logic
    const [membersDeleted, ordersDeleted, notifsDeleted, progressDeleted, enquiriesDeleted, transformsDeleted] = await Promise.all([
      User.deleteMany({ role: 'member' }).then(r => r.deletedCount),
      Order.deleteMany({}).then(r => r.deletedCount),
      Notification.deleteMany({}).then(r => r.deletedCount),
      ProgressEntry.deleteMany({}).then(r => r.deletedCount),
      Enquiry.deleteMany({}).then(r => r.deletedCount),
      Transformation.deleteMany({}).then(r => r.deletedCount),
    ]);
    cache.delPattern('analytics:');
    cache.delPattern('members:');
    cache.delPattern('orders:');
    cache.delPattern('notifications:');
    cache.delPattern('enquiries:');
    res.json({
      message: 'All demo/fake data cleared. Ready to add real data.',
      deleted: { members: membersDeleted, orders: ordersDeleted, notifications: notifsDeleted, progress: progressDeleted, enquiries: enquiriesDeleted, transformations: transformsDeleted },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
