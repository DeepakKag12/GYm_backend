const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const User = require('../models/User');
const cloudinary = require('../config/cloudinary');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');
const { sendWhatsApp } = require('../utils/whatsapp');
const { buildMemberStatement, statementData } = require('../utils/memberStatement');

function uploadStatement(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: 'raw',
      type: 'upload',
      public_id: publicId,
      format: 'pdf',
      access_mode: 'public',
      overwrite: true,
      invalidate: true,
    }, (err, result) => err ? reject(err) : resolve(result));
    stream.end(buffer);
  });
}

async function createStatement(memberId) {
  const member = await User.findOne({ _id: memberId, role: 'member' }).select('-password').lean();
  if (!member) return null;
  const payments = await Payment.find({ member: member._id, source: 'membership' })
    .select('amount method kind createdAt periodStart periodEnd')
    .sort({ createdAt: 1 })
    .lean();
  const pdf = await buildMemberStatement(member, payments);
  const upload = await uploadStatement(pdf, `member-statements/${member._id}-${Date.now()}`);
  return { member, payments, summary: statementData(member, payments), url: upload.secure_url };
}

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
      $or: [
        { feeDueAmount: { $gt: 0 } },
        { feePaid: false, feeDueAmount: { $in: [0, null] }, feeAmount: { $gt: 0 } },
      ],
    })
      .select('name email phone membershipPlan membershipStart membershipEnd feeAmount feeDueAmount membershipStatus feePaid')
      .sort({ membershipEnd: 1, name: 1 })
      .lean();
    const payments = await Payment.find({
      source: 'membership', member: { $in: members.map(member => member._id) },
    }).select('member amount method kind createdAt').sort({ createdAt: 1 }).lean();
    const paymentsByMember = new Map();
    payments.forEach(payment => {
      const key = String(payment.member);
      paymentsByMember.set(key, [...(paymentsByMember.get(key) || []), payment]);
    });
    const dueMembers = members.map(member => ({
      ...member,
      ...statementData(member, paymentsByMember.get(String(member._id)) || []),
      dueAmount: member.feeDueAmount > 0 ? member.feeDueAmount : member.feeAmount,
    }));
    res.json({ members: dueMembers, total: dueMembers.reduce((sum, member) => sum + member.dueAmount, 0) });
  } catch (err) { sendDbError(res, err, 'Could not load due fees.'); }
});

// POST /api/payments/:memberId/statement — prepare a PDF for direct sharing
router.post('/:memberId/statement', protect, adminOnly, async (req, res) => {
  try {
    const statement = await createStatement(req.params.memberId);
    if (!statement) return res.status(404).json({ message: 'Member not found.' });
    res.json({ message: 'Statement ready to share.', url: statement.url, member: { name: statement.member.name, phone: statement.member.phone } });
  } catch (err) { sendDbError(res, err, 'Could not generate the member statement.'); }
});

// POST /api/payments/:memberId/statement/whatsapp — send a PDF statement
router.post('/:memberId/statement/whatsapp', protect, adminOnly, async (req, res) => {
  try {
    const statement = await createStatement(req.params.memberId);
    if (!statement) return res.status(404).json({ message: 'Member not found.' });
    const { member, summary, url } = statement;
    const result = await sendWhatsApp(
      member.whatsapp || member.phone,
      `Hi ${member.name}, here is your FitNation payment statement. Total fee: INR ${summary.totalFee}. Paid: INR ${summary.paidTotal}. Remaining due: INR ${summary.due}.`,
      { mediaUrl: url },
    );
    if (!result.ok) return res.status(502).json({ message: result.error || result.reason || 'Could not send the statement on WhatsApp.', result });
    res.json({ message: `Statement sent to ${member.name}.`, result, url });
  } catch (err) { sendDbError(res, err, 'Could not generate or send the member statement.'); }
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
    const currentDue = memberDoc.feeDueAmount > 0 ? memberDoc.feeDueAmount : (memberDoc.feePaid ? 0 : memberDoc.feeAmount);
    if (currentDue > 0 && Number(amount) > currentDue) {
      return res.status(400).json({ message: `Payment cannot be greater than the remaining due amount of ${currentDue}.` });
    }

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
    const remaining = Math.max(0, currentDue - Number(amount));
    await User.updateOne({ _id: memberDoc._id }, { $set: { feeDueAmount: remaining, feePaid: remaining === 0 } });

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
      { $set: { feeAmount: Number(amount), feeDueAmount: Number(amount), feePaid: false } },
      { new: true, runValidators: true },
    ).select('name email phone membershipPlan membershipEnd feeAmount feeDueAmount membershipStatus');
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
      $or: [
        { feeDueAmount: { $gt: 0 } },
        { feePaid: false, feeDueAmount: { $in: [0, null] }, feeAmount: { $gt: 0 } },
      ],
    }).select('name feeAmount feeDueAmount membershipStart membershipEnd');

    const payments = [];
    for (const member of members) {
      payments.push(await Payment.create({
        member: member._id,
        source: 'membership',
        kind: 'adjustment',
        amount: member.feeDueAmount > 0 ? member.feeDueAmount : member.feeAmount,
        method: req.body.method || 'cash',
        note: req.body.note || 'Due fee settled',
        periodStart: member.membershipStart,
        periodEnd: member.membershipEnd,
        recordedBy: req.user._id,
      }));
    }

    await User.updateMany(
      { _id: { $in: members.map(member => member._id) } },
      { $set: { feeDueAmount: 0, feePaid: true } },
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
