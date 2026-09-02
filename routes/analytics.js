const express        = require('express');
const Payment = require('../models/Payment');
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

      // Counts the admin dashboard needs. Adding them here means that screen
      // makes ONE small request instead of downloading every member and every
      // enquiry document just to count them in the browser.
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalMembers, activeMembers, expiredMembers, pendingMembers,
        totalOrders, totalExercises, totalDietPlans, totalTrainers,
        revenueAgg, monthlyRevenueAgg, lastMonthRevenueAgg,
        newMembers30d, newEnquiries, disabledMembers,
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
        User.countDocuments({ role: 'member', createdAt: { $gte: thirtyDaysAgo } }),
        Enquiry.countDocuments({ status: 'new' }),
        User.countDocuments({ role: 'member', isActive: false }),
      ]);

      const expiringIn7 = await User.countDocuments({
        role: 'member',
        membershipEnd: { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) },
      });

      const revenue          = revenueAgg[0]?.total          || 0;
      const monthlyRevenue   = monthlyRevenueAgg[0]?.total   || 0;
      const lastMonthRevenue = lastMonthRevenueAgg[0]?.total || 0;

      /**
       * Membership income comes from the Payment ledger, not from summing each
       * member's current feeAmount.
       *
       * The old sum counted a member once at whatever they are charged today,
       * so a year of renewals still read as one month's fee, and income could
       * not be attributed to a month.
       */
      const membershipFeeRevenue = await Payment.aggregate([
        { $match: { source: 'membership' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
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
        expiringIn7, newMembers30d, newEnquiries, disabledMembers,
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
    // Note: $gte filter on membershipStart is optional — members without a start date
    // (or with null) are excluded from monthly breakdown but counted in totals below.
    const membershipByMonth = await User.aggregate([
      { $match: { role: 'member', feePaid: true, membershipStart: { $gte: twelveMonthsAgo, $ne: null } } },
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

// ─── POST /api/analytics/reset-to-production ─────────────────────────────────
// Admin: full production reset — wipes ALL transactional data.
// Deletes: ALL members, ALL orders, ALL notifications, ALL progress entries,
//          ALL enquiries, ALL transformations.
// Keeps:   admin user, trainers, membership plans, exercises (with videos),
//          diet plans, workout splits, products — these are config/content.
router.post('/reset-to-production', protect, adminOnly, async (req, res) => {
  try {
    const { confirm, password } = req.body;
    if (confirm !== 'RESET_TO_PRODUCTION') {
      return res.status(400).json({
        message: 'Send { confirm: "RESET_TO_PRODUCTION" } in the request body to confirm.',
      });
    }

    /**
     * This deletes every member. A magic string alone was not enough of a
     * guard for that — an admin session left open on the gym counter plus one
     * crafted request would empty the gym. The caller re-enters their own
     * password, checked against the stored hash.
     */
    if (!password) {
      return res.status(400).json({ message: 'Enter your password to confirm.' });
    }
    const bcrypt = require('bcryptjs');
    const me = await User.findById(req.user._id).select('password');
    if (!me || !(await bcrypt.compare(password, me.password))) {
      return res.status(401).json({ message: 'That password is not correct.' });
    }

    /**
     * One transaction, so the reset cannot half-succeed.
     *
     * Run in parallel outside a transaction, a failure partway through left the
     * database inconsistent — members gone but their orders and payments still
     * referencing them.
     *
     * Payment is included for the same reason: leaving the ledger behind would
     * report income for members who no longer exist.
     */
    const mongoose = require('mongoose');
    const Payment = require('../models/Payment');
    const session = await mongoose.startSession();
    let membersDeleted = 0, ordersDeleted = 0, notifsDeleted = 0,
        progressDeleted = 0, enquiriesDeleted = 0, transformsDeleted = 0, paymentsDeleted = 0;

    try {
      await session.withTransaction(async () => {
        membersDeleted    = (await User.deleteMany({ role: 'member' }, { session })).deletedCount;
        ordersDeleted     = (await Order.deleteMany({}, { session })).deletedCount;
        notifsDeleted     = (await Notification.deleteMany({}, { session })).deletedCount;
        progressDeleted   = (await ProgressEntry.deleteMany({}, { session })).deletedCount;
        enquiriesDeleted  = (await Enquiry.deleteMany({}, { session })).deletedCount;
        transformsDeleted = (await Transformation.deleteMany({}, { session })).deletedCount;
        paymentsDeleted   = (await Payment.deleteMany({}, { session })).deletedCount;
      });
    } finally {
      await session.endSession();
    }

    console.warn(`⚠️  reset-to-production by ${req.user.email}: ${membersDeleted} members, ${paymentsDeleted} payments`);

    // Bust every cache key
    cache.delPattern('analytics:');
    cache.delPattern('members:');
    cache.delPattern('orders:');
    cache.delPattern('notifications:');
    cache.delPattern('enquiries:');
    cache.del('payments:summary');

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


/**
 * POST /api/analytics/reset — wipe reporting data, password-confirmed.
 *
 * This is destructive and irreversible, so being an admin is not enough: the
 * caller must re-enter their own password in the same request. A session left
 * open on a gym counter should not be one stray click from erasing the books.
 *
 * Deliberately scoped. `scopes` names exactly what goes, and members, trainers
 * and their memberships are never touched — this clears the record of money and
 * messages, not the people.
 */
router.post('/reset', protect, adminOnly, async (req, res) => {
  try {
    const { password, scopes, confirm } = req.body || {};

    if (!password) {
      return res.status(400).json({ message: 'Enter your password to confirm.' });
    }
    if (confirm !== 'DELETE') {
      return res.status(400).json({ message: 'Type DELETE to confirm.' });
    }

    // Re-authenticate against the caller's own hash, freshly read — req.user is
    // cached by the protect middleware and has no password field.
    const bcrypt = require('bcryptjs');
    const admin = await User.findById(req.user._id).select('password');
    const ok = admin && await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ message: 'That password is not correct.' });

    const VALID = ['payments', 'orders', 'notifications', 'enquiries'];
    const wanted = Array.isArray(scopes) ? scopes.filter(s => VALID.includes(s)) : [];
    if (wanted.length === 0) {
      return res.status(400).json({ message: `Choose what to clear: ${VALID.join(', ')}.` });
    }

    const Payment = require('../models/Payment');
    const Notification = require('../models/Notification');
    const Enquiry = require('../models/Enquiry');

    const deleted = {};
    if (wanted.includes('payments'))      deleted.payments      = (await Payment.deleteMany({})).deletedCount;
    if (wanted.includes('orders'))        deleted.orders        = (await Order.deleteMany({})).deletedCount;
    if (wanted.includes('notifications')) deleted.notifications = (await Notification.deleteMany({})).deletedCount;
    if (wanted.includes('enquiries'))     deleted.enquiries     = (await Enquiry.deleteMany({})).deletedCount;

    cache.delPattern('analytics:');
    cache.del('payments:summary');
    cache.delPattern('notifs:');
    cache.del('enquiries:all');
    cache.del('orders:admin');

    console.warn(`⚠️  Data reset by ${req.user.email}: ${JSON.stringify(deleted)}`);

    const total = Object.values(deleted).reduce((n, v) => n + v, 0);
    res.json({ message: `Cleared ${total} record${total === 1 ? '' : 's'}.`, deleted });
  } catch (err) {
    console.error('Data reset failed:', err.message);
    res.status(500).json({ message: 'Could not clear the data.' });
  }
});

module.exports = router;
