const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');

/**
 * Money in, separated by where it came from.
 *
 * The two sources are genuinely different businesses: membership fees are
 * recurring and tied to a period, shop orders are one-off and tied to stock.
 * Reporting them as a single "revenue" number hid which half was growing.
 *
 * Store rows are read from Orders rather than duplicated into Payment, so a
 * paid order can never disagree with its payment row.
 */

/** Store income, shaped like a Payment so the two lists can be merged. */
async function storePayments({ from, to } = {}) {
  const match = { paymentStatus: 'paid' };
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }
  const orders = await Order.find(match)
    .select('user totalAmount createdAt paymentMethod items')
    .populate('user', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  return orders.map(o => ({
    _id: `order:${o._id}`,
    source: 'store',
    kind: 'order',
    amount: o.totalAmount || 0,
    member: o.user,
    method: o.paymentMethod || 'other',
    order: o._id,
    createdAt: o.createdAt,
    note: `${o.items?.length || 0} item${o.items?.length === 1 ? '' : 's'}`,
  }));
}

// GET /api/payments?source=membership|store|all
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const source = ['membership', 'store'].includes(req.query.source) ? req.query.source : 'all';
    const limit = Math.min(Number(req.query.limit) || 200, 500);

    const membership = source === 'store' ? [] : await Payment.find({ source: 'membership' })
      .populate('member', 'name phone email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const store = source === 'membership' ? [] : await storePayments();

    const rows = [...membership, ...store]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    const sum = list => list.reduce((n, r) => n + (r.amount || 0), 0);

    res.json({
      payments: rows,
      totals: {
        membership: sum(membership),
        store: sum(store),
        all: sum(membership) + sum(store),
      },
      counts: { membership: membership.length, store: store.length },
    });
  } catch (err) { sendDbError(res, err, 'Could not load payments.'); }
});

// GET /api/payments/due — active members whose current fee is unpaid
router.get('/due', protect, adminOnly, async (req, res) => {
  try {
    const members = await User.find({
      role: 'member',
      isActive: { $ne: false },
      feePaid: false,
      feeAmount: { $gt: 0 },
    })
      .select('name email phone membershipPlan membershipEnd feeAmount membershipStatus')
      .sort({ membershipEnd: 1, name: 1 })
      .lean();
    res.json({ members, total: members.reduce((sum, member) => sum + member.feeAmount, 0) });
  } catch (err) { sendDbError(res, err, 'Could not load due fees.'); }
});

// GET /api/payments/summary — totals and a month-by-month breakdown
router.get('/summary', protect, adminOnly, async (req, res) => {
  try {
    const data = await cache.getOrSet('payments:summary', 60, async () => {
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

      const byMonth = async (Model, match, amountField) => Model.aggregate([
        { $match: match },
        {
          $group: {
            _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
            total: { $sum: `$${amountField}` },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.y': -1, '_id.m': -1 } },
        { $limit: 12 },
      ]);

      const [memTotal, storeTotal, memMonth, storeMonth, memSeries, storeSeries] = await Promise.all([
        Payment.aggregate([{ $match: { source: 'membership' } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
        Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, t: { $sum: '$totalAmount' } } }]),
        Payment.aggregate([{ $match: { source: 'membership', createdAt: { $gte: monthStart } } }, { $group: { _id: null, t: { $sum: '$amount' } } }]),
        Order.aggregate([{ $match: { paymentStatus: 'paid', createdAt: { $gte: monthStart } } }, { $group: { _id: null, t: { $sum: '$totalAmount' } } }]),
        byMonth(Payment, { source: 'membership' }, 'amount'),
        byMonth(Order, { paymentStatus: 'paid' }, 'totalAmount'),
      ]);

      // Merge the two series so a month with only one kind of income still shows.
      const months = new Map();
      const put = (rows, key) => rows.forEach(r => {
        const id = `${r._id.y}-${String(r._id.m).padStart(2, '0')}`;
        const row = months.get(id) || { month: id, membership: 0, store: 0 };
        row[key] = r.total || 0;
        months.set(id, row);
      });
      put(memSeries, 'membership');
      put(storeSeries, 'store');

      const series = [...months.values()]
        .map(r => ({ ...r, total: r.membership + r.store }))
        .sort((a, b) => a.month.localeCompare(b.month));

      return {
        total: {
          membership: memTotal[0]?.t || 0,
          store: storeTotal[0]?.t || 0,
          all: (memTotal[0]?.t || 0) + (storeTotal[0]?.t || 0),
        },
        thisMonth: {
          membership: memMonth[0]?.t || 0,
          store: storeMonth[0]?.t || 0,
          all: (memMonth[0]?.t || 0) + (storeMonth[0]?.t || 0),
        },
        series,
      };
    });

    res.json(data);
  } catch (err) { sendDbError(res, err, 'Could not load the payment summary.'); }
});

// POST /api/payments — record a payment by hand (a fee taken at the desk)
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { member, amount, kind, method, note } = req.body;
    if (!mongoose.isValidObjectId(member)) {
      return res.status(400).json({ message: 'Choose which member paid.' });
    }
    if (!(Number(amount) > 0)) {
      return res.status(400).json({ message: 'Enter an amount greater than zero.' });
    }

    const memberDoc = await User.findOne({ _id: member, role: 'member' });
    if (!memberDoc) return res.status(404).json({ message: 'Member not found.' });

    const payment = await Payment.create({
      member,
      source: 'membership',
      kind: ['new-membership', 'renewal', 'adjustment'].includes(kind) ? kind : 'adjustment',
      amount: Number(amount),
      method: method || 'cash',
      note,
      recordedBy: req.user._id,
    });

    // The current fee model tracks one outstanding amount per member. A desk
    // payment settles that amount so the member leaves the due list.
    await User.updateOne({ _id: memberDoc._id }, { $set: { feePaid: true } });

    cache.del('payments:summary');
    cache.delPattern('analytics:');
    cache.del('members:all');
    res.status(201).json({ message: 'Payment recorded.', payment });
  } catch (err) { sendDbError(res, err, 'Could not record this payment.'); }
});

// POST /api/payments/due — add or replace one member's outstanding fee
router.post('/due', protect, adminOnly, async (req, res) => {
  try {
    const { member, amount } = req.body;
    if (!mongoose.isValidObjectId(member)) {
      return res.status(400).json({ message: 'Choose which member owes the fee.' });
    }
    if (!(Number(amount) > 0)) {
      return res.status(400).json({ message: 'Enter a due amount greater than zero.' });
    }

    const updated = await User.findOneAndUpdate(
      { _id: member, role: 'member' },
      { $set: { feeAmount: Number(amount), feePaid: false } },
      { new: true, runValidators: true },
    ).select('name email phone membershipPlan membershipEnd feeAmount membershipStatus');
    if (!updated) return res.status(404).json({ message: 'Member not found.' });

    cache.del('members:all');
    cache.delPattern('analytics:');
    res.status(201).json({ message: `Fee due added for ${updated.name}.`, member: updated });
  } catch (err) { sendDbError(res, err, 'Could not add this due fee.'); }
});

// POST /api/payments/due/settle — settle the selected members' full due amounts
router.post('/due/settle', protect, adminOnly, async (req, res) => {
  try {
    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
    const ids = [...new Set(memberIds.filter(mongoose.isValidObjectId))];
    if (!ids.length) return res.status(400).json({ message: 'Select at least one due member.' });

    const members = await User.find({
      _id: { $in: ids }, role: 'member', isActive: { $ne: false },
      feePaid: false, feeAmount: { $gt: 0 },
    }).select('name feeAmount membershipStart membershipEnd');

    const payments = [];
    for (const member of members) {
      payments.push(await Payment.create({
        member: member._id,
        source: 'membership',
        kind: 'adjustment',
        amount: member.feeAmount,
        method: req.body.method || 'cash',
        note: req.body.note || 'Due fee settled',
        periodStart: member.membershipStart,
        periodEnd: member.membershipEnd,
        recordedBy: req.user._id,
      }));
    }

    await User.updateMany(
      { _id: { $in: members.map(member => member._id) } },
      { $set: { feePaid: true } },
    );
    cache.del('payments:summary');
    cache.del('members:all');
    cache.delPattern('analytics:');
    res.json({
      message: `${payments.length} due fee${payments.length === 1 ? '' : 's'} marked paid.`,
      count: payments.length,
      skipped: ids.length - payments.length,
    });
  } catch (err) { sendDbError(res, err, 'Could not settle the selected fees.'); }
});


/**
 * POST /api/payments/backfill — seed the ledger from existing members.
 *
 * The ledger starts empty, so fees taken before it existed are invisible and
 * revenue reads zero. Each member who is marked as having paid gets one row for
 * their current period, dated to when that period started rather than to today,
 * so the figure lands in the right month.
 *
 * Idempotent: the key is the member plus their period, so running it twice
 * cannot double-count. It only ever *adds* what is missing — nothing is
 * overwritten or removed.
 */
router.post('/backfill', protect, adminOnly, async (req, res) => {
  try {
    const User = require('../models/User');
    const members = await User.find({
      role: 'member',
      feePaid: true,
      feeAmount: { $gt: 0 },
    }).select('name feeAmount membershipStart membershipEnd createdAt').lean();

    let created = 0, skipped = 0;
    for (const m of members) {
      const start = m.membershipStart || m.createdAt;
      const key = `backfill:${m._id}:${start ? new Date(start).toISOString() : 'none'}`;
      try {
        await Payment.create({
          member: m._id,
          source: 'membership',
          kind: 'new-membership',
          amount: m.feeAmount,
          periodStart: m.membershipStart,
          periodEnd: m.membershipEnd,
          idempotencyKey: key,
          recordedBy: req.user._id,
          note: 'Recorded from existing membership fee',
          // Dated to the period, not to now, so reports attribute it correctly.
          createdAt: start || new Date(),
        });
        created++;
      } catch (err) {
        if (err?.code === 11000) skipped++;
        else throw err;
      }
    }

    cache.del('payments:summary');
    cache.delPattern('analytics:');

    res.json({
      message: created
        ? `Added ${created} payment${created === 1 ? '' : 's'} from existing members.`
        : 'Nothing to add — every paid member already has a payment recorded.',
      created,
      skipped,
    });
  } catch (err) { sendDbError(res, err, 'Could not backfill payments.'); }
});

module.exports = router;
