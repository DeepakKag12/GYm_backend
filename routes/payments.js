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

// GET /api/payments/:memberId/statement — stream the PDF directly to the browser (view / download)
router.get('/:memberId/statement', protect, adminOnly, async (req, res) => {
  try {
    const member = await User.findOne({ _id: req.params.memberId, role: 'member' }).select('-password').lean();
    if (!member) return res.status(404).json({ message: 'Member not found.' });
    const payments = await Payment.find({ member: member._id, source: 'membership' })
      .select('amount method kind createdAt periodStart periodEnd')
      .sort({ createdAt: 1 })
      .lean();
    const pdf = await buildMemberStatement(member, payments);
    const filename = `${(member.name || 'member').replace(/[^a-z0-9]/gi, '-')}-statement.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'no-store',
    });
    res.end(pdf);
  } catch (err) { sendDbError(res, err, 'Could not generate the member statement.'); }
});

// POST /api/payments/:memberId/statement — prepare a PDF and upload to Cloudinary for sharing
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

// POST /api/payments — record a payment by hand (a fee taken at the desk or partial/full due settlement)
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { member, amount, kind, method, note } = req.body;
    if (!mongoose.isValidObjectId(member)) {
      return res.status(400).json({ message: 'Choose which member paid.' });
    }
    const payNum = Number(amount);
    if (!(payNum > 0)) {
      return res.status(400).json({ message: 'Enter an amount greater than zero.' });
    }

    const memberDoc = await User.findOne({ _id: member, role: 'member' });
    if (!memberDoc) return res.status(404).json({ message: 'Member not found.' });
    const currentDue = memberDoc.feeDueAmount > 0 ? memberDoc.feeDueAmount : (memberDoc.feePaid ? 0 : memberDoc.feeAmount);
    if (currentDue > 0 && payNum > currentDue) {
      return res.status(400).json({ message: `Payment cannot be greater than the remaining due amount of ₹${currentDue}.` });
    }

    const payment = await Payment.create({
      member,
      source: 'membership',
      kind: ['new-membership', 'renewal', 'adjustment'].includes(kind) ? kind : 'adjustment',
      amount: payNum,
      method: method || 'cash',
      note,
      recordedBy: req.user._id,
    });

    // The current fee model tracks one outstanding amount per member. A desk
    // payment settles that amount so the member leaves the due list if completely settled.
    const remaining = Math.max(0, currentDue - payNum);
    await User.updateOne({ _id: memberDoc._id }, { $set: { feeDueAmount: remaining, feePaid: remaining === 0 } });

    cache.del('payments:summary');
    cache.delPattern('analytics:');
    cache.del('members:all');
    res.status(201).json({
      message: remaining > 0
        ? `Payment of ₹${payNum.toLocaleString('en-IN')} recorded. Remaining due: ₹${remaining.toLocaleString('en-IN')}.`
        : `Payment of ₹${payNum.toLocaleString('en-IN')} recorded. Fee marked fully paid.`,
      payment,
      remaining,
    });
  } catch (err) { sendDbError(res, err, 'Could not record this payment.'); }
});

// POST /api/payments/due — add or setup one member's outstanding fee (with optional initial payment)
router.post('/due', protect, adminOnly, async (req, res) => {
  try {
    const { member, amount, paidAmount, method, note } = req.body;
    if (!mongoose.isValidObjectId(member)) {
      return res.status(400).json({ message: 'Choose which member owes the fee.' });
    }
    const totalAmount = Number(amount);
    if (!(totalAmount > 0)) {
      return res.status(400).json({ message: 'Enter a due amount greater than zero.' });
    }

    const memberDoc = await User.findOne({ _id: member, role: 'member' });
    if (!memberDoc) return res.status(404).json({ message: 'Member not found.' });

    const paid = Number(paidAmount || 0);
    if (paid < 0) {
      return res.status(400).json({ message: 'Paid amount cannot be negative.' });
    }
    if (paid > totalAmount) {
      return res.status(400).json({ message: 'Paid amount cannot be greater than the total fee amount.' });
    }

    let payment = null;
    if (paid > 0) {
      payment = await Payment.create({
        member: memberDoc._id,
        source: 'membership',
        kind: 'adjustment',
        amount: paid,
        method: method || 'cash',
        note: note || 'Payment on due fee setup',
        recordedBy: req.user._id,
      });
    }

    const remaining = Math.max(0, totalAmount - paid);
    memberDoc.feeAmount = Math.max(Number(memberDoc.feeAmount || 0), totalAmount);
    memberDoc.feeDueAmount = remaining;
    memberDoc.feePaid = remaining === 0;
    await memberDoc.save();

    cache.del('payments:summary');
    cache.del('members:all');
    cache.delPattern('analytics:');

    res.status(201).json({
      message: paid > 0
        ? `Paid ₹${paid.toLocaleString('en-IN')} added to revenue. Remaining ₹${remaining.toLocaleString('en-IN')} kept as due for ${memberDoc.name}.`
        : `Fee due of ₹${totalAmount.toLocaleString('en-IN')} added for ${memberDoc.name}.`,
      member: memberDoc,
      payment,
      remaining,
      paid,
    });
  } catch (err) { sendDbError(res, err, 'Could not add this due fee.'); }
});

// PATCH / PUT /api/payments/due/:memberId — directly edit or adjust a member's due fee
const handleUpdateDue = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { dueAmount } = req.body;
    if (!mongoose.isValidObjectId(memberId)) {
      return res.status(400).json({ message: 'Invalid member ID.' });
    }
    const newDue = Number(dueAmount);
    if (isNaN(newDue) || newDue < 0) {
      return res.status(400).json({ message: 'Due amount must be a number greater than or equal to 0.' });
    }

    const memberDoc = await User.findOne({ _id: memberId, role: 'member' });
    if (!memberDoc) return res.status(404).json({ message: 'Member not found.' });

    memberDoc.feeDueAmount = newDue;
    memberDoc.feePaid = newDue === 0;
    if (newDue > Number(memberDoc.feeAmount || 0)) {
      memberDoc.feeAmount = newDue;
    }
    await memberDoc.save();

    cache.del('payments:summary');
    cache.del('members:all');
    cache.delPattern('analytics:');

    res.json({
      message: `Due amount for ${memberDoc.name} updated to ₹${newDue.toLocaleString('en-IN')}.`,
      member: memberDoc,
      dueAmount: newDue,
    });
  } catch (err) { sendDbError(res, err, 'Could not update due amount.'); }
};

router.patch('/due/:memberId', protect, adminOnly, handleUpdateDue);
router.put('/due/:memberId', protect, adminOnly, handleUpdateDue);

// POST /api/payments/due/settle — settle the selected members' full due amounts
router.post('/due/settle', protect, adminOnly, async (req, res) => {
  try {
    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds : [];
    const ids = [...new Set(memberIds.filter(mongoose.isValidObjectId))];
    if (!ids.length) return res.status(400).json({ message: 'Select at least one due member.' });

    const session = await mongoose.startSession();
    let settledCount = 0;
    try {
      await session.withTransaction(async () => {
        const members = await User.find({
          _id: { $in: ids }, role: 'member', isActive: { $ne: false },
          $or: [
            { feeDueAmount: { $gt: 0 } },
            { feePaid: false, feeDueAmount: { $in: [0, null] }, feeAmount: { $gt: 0 } },
          ],
        }).select('name feeAmount feeDueAmount membershipStart membershipEnd').session(session);

        for (const member of members) {
          const amount = member.feeDueAmount > 0 ? member.feeDueAmount : member.feeAmount;
          await Payment.create([{
            member: member._id,
            source: 'membership',
            kind: 'adjustment',
            amount,
            method: req.body.method || 'cash',
            note: req.body.note || 'Due fee settled',
            periodStart: member.membershipStart,
            periodEnd: member.membershipEnd,
            recordedBy: req.user._id,
          }], { session });
        }

        settledCount = members.length;
        await User.updateMany(
          { _id: { $in: members.map(member => member._id) } },
          { $set: { feeDueAmount: 0, feePaid: true } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    cache.del('payments:summary');
    cache.del('members:all');
    cache.delPattern('analytics:');
    res.json({
      message: `${settledCount} due fee${settledCount === 1 ? '' : 's'} marked paid.`,
      count: settledCount,
      skipped: ids.length - settledCount,
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
