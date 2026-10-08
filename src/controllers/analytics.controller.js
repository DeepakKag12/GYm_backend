const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Payment = require('../models/Payment.model');
const User = require('../models/User.model');
const Order = require('../models/Order.model');
const Exercise = require('../models/Exercise.model');
const DietPlan = require('../models/DietPlan.model');
const Notification = require('../models/Notification.model');
const ProgressEntry = require('../models/ProgressEntry.model');
const Enquiry = require('../models/Enquiry.model');
const Transformation = require('../models/Transformation.model');
const WorkoutSplit = require('../models/WorkoutSplit.model');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { sendDbError } = require('../utils/dbError');

function monthStart(offsetFromNow = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetFromNow);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/analytics/summary
const getSummary = asyncHandler(async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:summary', 30, async () => {
      const now = new Date();
      const thisMonthStart = monthStart(0);
      const lastMonthStart = monthStart(-1);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysLater = new Date(now.getTime() + 7 * 86400000);

      const [
        userAgg,
        orderAgg,
        paymentAgg,
        totalOrders,
        totalExercises,
        totalDietPlans,
        newEnquiries,
      ] = await Promise.all([
        User.aggregate([
          {
            $facet: {
              counts: [
                {
                  $group: {
                    _id: null,
                    totalMembers: { $sum: { $cond: [{ $eq: ['$role', 'member'] }, 1, 0] } },
                    activeMembers: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ['$role', 'member'] }, { $eq: ['$membershipStatus', 'active'] }] },
                          1,
                          0,
                        ],
                      },
                    },
                    expiredMembers: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ['$role', 'member'] }, { $eq: ['$membershipStatus', 'expired'] }] },
                          1,
                          0,
                        ],
                      },
                    },
                    pendingMembers: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ['$role', 'member'] }, { $eq: ['$membershipStatus', 'pending'] }] },
                          1,
                          0,
                        ],
                      },
                    },
                    totalTrainers: { $sum: { $cond: [{ $eq: ['$role', 'trainer'] }, 1, 0] } },
                    newMembers30d: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ['$role', 'member'] }, { $gte: ['$createdAt', thirtyDaysAgo] }] },
                          1,
                          0,
                        ],
                      },
                    },
                    disabledMembers: {
                      $sum: {
                        $cond: [
                          { $and: [{ $eq: ['$role', 'member'] }, { $eq: ['$isActive', false] }] },
                          1,
                          0,
                        ],
                      },
                    },
                    expiringIn7: {
                      $sum: {
                        $cond: [
                          {
                            $and: [
                              { $eq: ['$role', 'member'] },
                              { $gte: ['$membershipEnd', now] },
                              { $lte: ['$membershipEnd', sevenDaysLater] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    },
                  },
                },
              ],
              pendingFees: [
                {
                  $match: {
                    role: 'member',
                    membershipStatus: 'active',
                    $or: [
                      { feeDueAmount: { $gt: 0 } },
                      { feePaid: false, feeDueAmount: { $in: [0, null] }, feeAmount: { $gt: 0 } },
                    ],
                  },
                },
                {
                  $group: {
                    _id: null,
                    total: {
                      $sum: { $cond: [{ $gt: ['$feeDueAmount', 0] }, '$feeDueAmount', '$feeAmount'] },
                    },
                    count: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ]),
        Order.aggregate([
          { $match: { paymentStatus: 'paid' } },
          {
            $group: {
              _id: null,
              total: { $sum: '$totalAmount' },
              monthly: {
                $sum: {
                  $cond: [{ $gte: ['$createdAt', thisMonthStart] }, '$totalAmount', 0],
                },
              },
              lastMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$createdAt', lastMonthStart] },
                        { $lt: ['$createdAt', thisMonthStart] },
                      ],
                    },
                    '$totalAmount',
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Payment.aggregate([
          { $match: { source: 'membership' } },
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' },
              monthly: {
                $sum: {
                  $cond: [{ $gte: ['$createdAt', thisMonthStart] }, '$amount', 0],
                },
              },
              lastMonth: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$createdAt', lastMonthStart] },
                        { $lt: ['$createdAt', thisMonthStart] },
                      ],
                    },
                    '$amount',
                    0,
                  ],
                },
              },
            },
          },
        ]),
        Order.countDocuments({}),
        Exercise.countDocuments({}),
        DietPlan.countDocuments({}),
        Enquiry.countDocuments({ status: 'new' }),
      ]);

      const userCounts = userAgg[0]?.counts[0] || {};
      const pendingFeeResult = userAgg[0]?.pendingFees[0] || {};

      const totalMembers    = userCounts.totalMembers || 0;
      const activeMembers   = userCounts.activeMembers || 0;
      const expiredMembers  = userCounts.expiredMembers || 0;
      const pendingMembers  = userCounts.pendingMembers || 0;
      const totalTrainers   = userCounts.totalTrainers || 0;
      const newMembers30d   = userCounts.newMembers30d || 0;
      const disabledMembers = userCounts.disabledMembers || 0;
      const expiringIn7     = userCounts.expiringIn7 || 0;

      const storeRevenue          = orderAgg[0]?.total     || 0;
      const storeMonthlyRevenue   = orderAgg[0]?.monthly   || 0;
      const storeLastMonthRevenue = orderAgg[0]?.lastMonth || 0;

      const membershipRevenue          = paymentAgg[0]?.total     || 0;
      const membershipMonthlyRevenue   = paymentAgg[0]?.monthly   || 0;
      const membershipLastMonthRevenue = paymentAgg[0]?.lastMonth || 0;

      const totalRevenue               = storeRevenue + membershipRevenue;
      const totalMonthlyRevenue        = storeMonthlyRevenue + membershipMonthlyRevenue;
      const totalLastMonthRevenue      = storeLastMonthRevenue + membershipLastMonthRevenue;

      const pendingFees     = pendingFeeResult.total || 0;
      const pendingFeeCount = pendingFeeResult.count || 0;

      return {
        totalMembers, activeMembers, expiredMembers, pendingMembers,
        expiringIn7, newMembers30d, newEnquiries, disabledMembers,
        totalOrders,
        totalExercises,
        totalDietPlans,
        totalTrainers,
        revenue: totalRevenue,
        monthlyRevenue: totalMonthlyRevenue,
        lastMonthRevenue: totalLastMonthRevenue,
        storeRevenue,
        membershipRevenue,
        membershipMonthlyRevenue,
        pendingFees,
        pendingFeeCount,
      };
    });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/analytics/trainer-summary
const getTrainerSummary = asyncHandler(async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:trainer-summary', 30, async () => {
      const [userCounts, totalExercises, totalDietPlans] = await Promise.all([
        User.aggregate([
          {
            $match: { role: 'member' },
          },
          {
            $group: {
              _id: null,
              totalMembers: { $sum: 1 },
              activeMembers: {
                $sum: { $cond: [{ $eq: ['$membershipStatus', 'active'] }, 1, 0] },
              },
            },
          },
        ]),
        Exercise.countDocuments({}),
        DietPlan.countDocuments({}),
      ]);
      const totalMembers = userCounts[0]?.totalMembers || 0;
      const activeMembers = userCounts[0]?.activeMembers || 0;
      return { totalMembers, activeMembers, totalExercises, totalDietPlans };
    });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/analytics/revenue-monthly
const getRevenueMonthly = asyncHandler(async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:revenue-monthly', 30, async () => {
      const sixMonthsAgo = monthStart(-5);
      const [orderRows, paymentRows] = await Promise.all([
        Order.aggregate([
          { $match: { createdAt: { $gte: sixMonthsAgo }, paymentStatus: 'paid' } },
          { $group: {
              _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
              revenue: { $sum: '$totalAmount' },
              orders:  { $sum: 1 },
            },
          },
        ]),
        Payment.aggregate([
          { $match: { createdAt: { $gte: sixMonthsAgo }, source: 'membership' } },
          { $group: {
              _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
              revenue: { $sum: '$amount' },
              payments: { $sum: 1 },
            },
          },
        ]),
      ]);

      const map = new Map();
      orderRows.forEach(r => {
        const key = `${r._id.year}-${r._id.month}`;
        map.set(key, { _id: r._id, revenue: r.revenue || 0, orders: r.orders || 0 });
      });
      paymentRows.forEach(r => {
        const key = `${r._id.year}-${r._id.month}`;
        const existing = map.get(key) || { _id: r._id, revenue: 0, orders: 0 };
        existing.revenue += (r.revenue || 0);
        map.set(key, existing);
      });

      return Array.from(map.values()).sort((a, b) => {
        if (a._id.year !== b._id.year) return a._id.year - b._id.year;
        return a._id.month - b._id.month;
      });
    });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/analytics/membership-stats
const getMembershipStats = asyncHandler(async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:membership-stats', 30, () =>
      User.aggregate([
        { $match: { role: 'member' } },
        { $group: { _id: '$membershipPlan', count: { $sum: 1 }, revenue: { $sum: '$feeAmount' } } },
      ])
    );
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/analytics/new-members-monthly
const getNewMembersMonthly = asyncHandler(async (req, res) => {
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
  } catch (err) { sendDbError(res, err); }
});

// GET /api/analytics/revenue-full
const getRevenueFull = asyncHandler(async (req, res) => {
  try {
    const data = await cache.getOrSet('analytics:revenue-full', 30, async () => {
      const twelveMonthsAgo = monthStart(-11);
      const now = new Date();

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

      const membershipByMonth = await Payment.aggregate([
        { $match: { source: 'membership', createdAt: { $gte: twelveMonthsAgo } } },
        { $group: {
            _id:               { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            membershipRevenue: { $sum: '$amount' },
            memberCount:       { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]);

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

      const planBreakdown = await User.aggregate([
        { $match: { role: 'member', feePaid: true } },
        { $group: {
            _id:     '$membershipPlan',
            revenue: { $sum: '$feeAmount' },
            count:   { $sum: 1 },
          },
        },
      ]);

      const [orderMethods, paymentMethods] = await Promise.all([
        Order.aggregate([
          { $match: { paymentStatus: 'paid' } },
          { $group: {
              _id:     '$paymentMethod',
              revenue: { $sum: '$totalAmount' },
              count:   { $sum: 1 },
            },
          },
        ]),
        Payment.aggregate([
          { $match: { source: 'membership' } },
          { $group: {
              _id:     '$method',
              revenue: { $sum: '$amount' },
              count:   { $sum: 1 },
            },
          },
        ]),
      ]);

      const methodMap = new Map();
      orderMethods.forEach(m => {
        const k = m._id || 'other';
        methodMap.set(k, { _id: k, revenue: m.revenue || 0, count: m.count || 0 });
      });
      paymentMethods.forEach(m => {
        const k = m._id || 'other';
        const existing = methodMap.get(k) || { _id: k, revenue: 0, count: 0 };
        existing.revenue += (m.revenue || 0);
        existing.count += (m.count || 0);
        methodMap.set(k, existing);
      });
      const paymentMethodBreakdown = Array.from(methodMap.values());

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

      const pendingFeeMembers = await User.find({
        role: 'member', feePaid: false, membershipStatus: 'active',
      }).select('name phone membershipPlan feeAmount membershipEnd').lean();

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
    });
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) { sendDbError(res, err); }
});

// POST /api/analytics/reset-to-production
const resetToProduction = asyncHandler(async (req, res) => {
  try {
    const { confirm, password } = req.body;
    if (confirm !== 'RESET_TO_PRODUCTION') {
      return res.status(400).json({
        message: 'Send { confirm: "RESET_TO_PRODUCTION" } in the request body to confirm.',
      });
    }

    if (!password) {
      return res.status(400).json({ message: 'Enter your password to confirm.' });
    }
    const me = await User.findById(req.user._id).select('password');
    if (!me || !(await bcrypt.compare(password, me.password))) {
      return res.status(401).json({ message: 'That password is not correct.' });
    }

    const session = await mongoose.startSession();
    let membersDeleted = 0, ordersDeleted = 0, notifsDeleted = 0,
        progressDeleted = 0, enquiriesDeleted = 0, transformsDeleted = 0,
        paymentsDeleted = 0, splitsDeleted = 0;

    try {
      await session.withTransaction(async () => {
        membersDeleted    = (await User.deleteMany({ role: 'member' }, { session })).deletedCount;
        ordersDeleted     = (await Order.deleteMany({}, { session })).deletedCount;
        notifsDeleted     = (await Notification.deleteMany({}, { session })).deletedCount;
        progressDeleted   = (await ProgressEntry.deleteMany({}, { session })).deletedCount;
        enquiriesDeleted  = (await Enquiry.deleteMany({}, { session })).deletedCount;
        transformsDeleted = (await Transformation.deleteMany({}, { session })).deletedCount;
        paymentsDeleted   = (await Payment.deleteMany({}, { session })).deletedCount;

        splitsDeleted = (await WorkoutSplit.deleteMany(
          { member: { $ne: null } }, { session },
        )).deletedCount;
        await DietPlan.updateMany(
          { assignedTo: { $ne: [] } }, { $set: { assignedTo: [] } }, { session },
        );
      });
    } finally {
      await session.endSession();
    }

    console.warn(`⚠️  reset-to-production by ${req.user.email}: ${membersDeleted} members, ${paymentsDeleted} payments`);

    cache.delPattern('analytics:');
    cache.delPattern('members:');
    cache.delPattern('orders:');
    cache.delPattern('notifications:');
    cache.delPattern('enquiries:');
    cache.delPattern('splits:');
    cache.del('payments:summary');

    res.json({
      message: 'Production reset complete. Ready to add real data.',
      kept: 'Admin, trainers, membership plans, exercises, diet plans, workout splits, products',
      deleted: {
        members:         membersDeleted,
        payments:        paymentsDeleted,
        orders:          ordersDeleted,
        notifications:   notifsDeleted,
        progressEntries: progressDeleted,
        enquiries:       enquiriesDeleted,
        transformations: transformsDeleted,
        personalSplits:  splitsDeleted,
      },
    });
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/analytics/reset
const resetAnalytics = asyncHandler(async (req, res) => {
  try {
    const { password, scopes, confirm } = req.body || {};

    if (!password) {
      return res.status(400).json({ message: 'Enter your password to confirm.' });
    }
    if (confirm !== 'DELETE') {
      return res.status(400).json({ message: 'Type DELETE to confirm.' });
    }

    const admin = await User.findById(req.user._id).select('password');
    const ok = admin && await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ message: 'That password is not correct.' });

    const VALID = ['payments', 'orders', 'notifications', 'enquiries'];
    const wanted = Array.isArray(scopes) ? scopes.filter(s => VALID.includes(s)) : [];
    if (wanted.length === 0) {
      return res.status(400).json({ message: `Choose what to clear: ${VALID.join(', ')}.` });
    }

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

module.exports = {
  getSummary,
  getTrainerSummary,
  getRevenueMonthly,
  getMembershipStats,
  getNewMembersMonthly,
  getRevenueFull,
  resetToProduction,
  resetAnalytics,
};
