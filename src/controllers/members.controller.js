const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User.model');
const Notification = require('../models/Notification.model');
const ProgressEntry = require('../models/ProgressEntry.model');
const WorkoutSplit = require('../models/WorkoutSplit.model');
const Exercise = require('../models/Exercise.model');
const DietPlan = require('../models/DietPlan.model');
const Payment = require('../models/Payment.model');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { sendDbError } = require('../utils/dbError');
const { notifyMember, notifyMembers } = require('../services/notify');
const { findDuplicate } = require('../utils/duplicateUser');
const { BRAND, SITE_URL } = require('../utils/emailTemplate');
const { calcExpiry, daysRemaining } = require('../utils/dateUtils');
const { canonicalPhone } = require('../utils/phone');

function invalidateAnalytics() {
  cache.delPattern('analytics:');
}

const MEMBERS_CACHE_KEY = 'members:all';
const USERS_ADMIN_ALL_KEY = 'users:admin:all';

function bustMembersCache() {
  cache.del(MEMBERS_CACHE_KEY);
  cache.del(USERS_ADMIN_ALL_KEY);
}

async function sendWelcome(member, { usedPhoneAsPassword } = {}) {
  const loginUrl = `${process.env.FRONTEND_URL || SITE_URL}/login`;

  const passwordLine = usedPhoneAsPassword
    ? `Password: your registered mobile number (${member.phone})`
    : 'Password: the one your gym set for you';

  return notifyMember(member, {
    type: 'welcome',
    title: 'Welcome to FitNation by Ajeet',
    subject: `Welcome to ${BRAND} — your login details`,
    message: `Hi ${member.name}! Your membership is now active.\n\nSign in at: ${loginUrl}\nEmail: ${member.email}\n${passwordLine}\n\nPlease change your password after your first sign-in.\n\nWe're excited to have you with us.`,
    ctaText: 'Sign in',
    ctaUrl: loginUrl,
  }, { channels: ['website', 'email', 'whatsapp'] });
}

function buildReminderText(member) {
  const end = member.membershipEnd ? new Date(member.membershipEnd) : null;
  const when = end ? end.toLocaleDateString('en-IN') : 'soon';
  const left = end ? daysRemaining(member.membershipEnd, new Date()) : null;
  const phrase = left === null ? `on ${when}`
    : left < 0 ? `expired on ${when}`
    : left === 0 ? 'expires today'
    : `expires in ${left} day${left > 1 ? 's' : ''} on ${when}`;
  return `Dear ${member.name}, your ${BRAND} membership ${phrase}. Please renew to keep training. ${process.env.FRONTEND_URL || SITE_URL}/plans`;
}

function whatsappLinkFor(member, text) {
  const digits = String(member.whatsapp || member.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const e164 = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

// GET /api/members/roster
const getRoster = asyncHandler(async (req, res) => {
  try {
    const members = await User.find({ role: 'member' })
      .select('name membershipPlan membershipStatus membershipStart membershipEnd')
      .sort({ createdAt: -1 })
      .lean();
    res.json(members);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/members
const getMembers = asyncHandler(async (req, res) => {
  try {
    const isAll = req.query.all === '1' || req.query.role === 'all';
    const cacheKey = isAll ? 'users:admin:all' : MEMBERS_CACHE_KEY;
    const members = await cache.getOrSet(cacheKey, 60, () =>
      User.find(isAll ? {} : { role: 'member' })
        .select('-password')
        .populate('assignedTrainer', 'name phone')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(members);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/members/:id
const getMemberById = asyncHandler(async (req, res) => {
  try {
    const isSelf = req.user._id.toString() === req.params.id;
    if (!isSelf && req.user.role !== 'admin' && req.user.role !== 'trainer') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const key = `member:profile:${req.params.id}`;
    const member = await cache.getOrSet(key, 120, () =>
      User.findById(req.params.id)
        .select('-password')
        .populate('assignedTrainer', 'name phone')
        .lean()
    );
    if (!member) return res.status(404).json({ message: 'Member not found' });
    res.json(member);
  } catch (err) { sendDbError(res, err); }
});

// POST /api/members
const createMember = asyncHandler(async (req, res) => {
  try {
    const {
      name, email, phone, whatsapp, password,
      membershipPlan, membershipStart, membershipEnd,
      feeAmount, initialPayment, paymentDue, paymentMethod, assignedTrainer, gender, dob, address
    } = req.body;

    const clash = await findDuplicate({ email, phone });
    if (clash) {
      return res.status(409).json({
        message: clash.message,
        field: clash.field,
        existingUser: { _id: clash.user._id, name: clash.user.name, role: clash.user.role },
      });
    }

    const expiry = membershipEnd || calcExpiry(membershipStart, membershipPlan);
    const totalFee = Math.max(0, Number(feeAmount) || 0);
    const requestedPayment = initialPayment === undefined || initialPayment === ''
      ? (paymentDue ? 0 : totalFee)
      : Math.max(0, Number(initialPayment) || 0);
    if (requestedPayment > totalFee) {
      return res.status(400).json({ message: 'Initial payment cannot be greater than the fee amount.' });
    }
    const dueAmount = Math.max(0, totalFee - requestedPayment);

    const fallbackPassword = canonicalPhone(phone) || phone;
    const usedPhoneAsPassword = !password;
    if (usedPhoneAsPassword && !fallbackPassword) {
      return res.status(400).json({ message: 'Provide a password, or a mobile number to use as one.' });
    }
    const hashed = await bcrypt.hash(password || fallbackPassword, 10);

    const session = await mongoose.startSession();
    let member;
    try {
      await session.withTransaction(async () => {
        const [created] = await User.create([{
          name, email, phone, whatsapp,
          password: hashed,
          role: 'member',
          membershipPlan,
          membershipStart,
          membershipEnd: expiry,
          feeAmount: totalFee,
          feeDueAmount: dueAmount,
          assignedTrainer: assignedTrainer || undefined,
          gender, dob, address,
          membershipStatus: 'active',
          feePaid: dueAmount === 0,
        }], { session });
        member = created;

        if (requestedPayment > 0) {
          await Payment.create([{
            member: member._id,
            source: 'membership',
            kind: 'new-membership',
            amount: requestedPayment,
            method: paymentMethod || 'cash',
            periodStart: member.membershipStart,
            periodEnd: member.membershipEnd,
            recordedBy: req.user._id,
            note: 'Joining fee',
          }], { session });
        }
      });
    } finally {
      await session.endSession();
    }

    invalidateAnalytics();
    bustMembersCache();
    sendWelcome(member, { usedPhoneAsPassword }).catch(() => {});
    const safe = member.toObject(); delete safe.password;
    res.status(201).json(safe);
  } catch (err) { sendDbError(res, err, 'Could not create this member.'); }
});

// PUT /api/members/:id
const updateMember = asyncHandler(async (req, res) => {
  try {
    const ALLOWED = [
      'name', 'email', 'phone', 'whatsapp', 'address', 'dob', 'gender', 'avatar',
      'membershipPlan', 'membershipStart', 'membershipEnd', 'membershipStatus',
      'feePaid', 'feeAmount', 'feeDueAmount', 'assignedTrainer', 'isActive',
    ];
    const update = {};
    for (const k of ALLOWED) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    if (update.email || update.phone) {
      const clash = await findDuplicate({
        email: update.email, phone: update.phone, excludeId: req.params.id,
      });
      if (clash) {
        return res.status(409).json({
          message: clash.message,
          field: clash.field,
          existingUser: { _id: clash.user._id, name: clash.user.name, role: clash.user.role },
        });
      }
    }
    if (req.body.password) {
      update.password = await bcrypt.hash(req.body.password, 10);
    }

    if (update.membershipStart && update.membershipPlan && !update.membershipEnd) {
      update.membershipEnd = calcExpiry(update.membershipStart, update.membershipPlan);
    }

    const current = await User.findById(req.params.id).select('membershipEnd membershipStatus feeAmount feeDueAmount feePaid').lean();
    if (!current) return res.status(404).json({ message: 'Member not found' });

    const endMoved = update.membershipEnd !== undefined && (
      !current.membershipEnd ||
      new Date(update.membershipEnd).getTime() !== new Date(current.membershipEnd).getTime()
    );

    if (endMoved) {
      update.reminderSent7days        = false;
      update.reminderSent3days        = false;
      update.reminderSentExpiry       = false;
      update.reminderSentWA2days      = false;
      update.reminderSentWAExpiry     = false;
      update.reminderSentWA1dayAfter  = false;
      const renewalFee = req.body.feeAmount !== undefined && req.body.feeAmount !== ''
        ? Math.max(0, Number(req.body.feeAmount) || 0)
        : Math.max(0, Number(current.feeAmount) || 0);
      update.feeAmount = renewalFee;

      const renewalPayment = req.body.initialPayment === undefined || req.body.initialPayment === ''
        ? (req.body.feePaid === false ? 0 : (req.body.feePaid === true ? renewalFee : (current.feePaid ? renewalFee : 0)))
        : Math.max(0, Number(req.body.initialPayment) || 0);
      if (renewalPayment > renewalFee) {
        return res.status(400).json({ message: 'Payment cannot be greater than the renewal fee.' });
      }
      update.feeDueAmount = Math.max(0, renewalFee - renewalPayment);
      update.feePaid = update.feeDueAmount === 0;

      const endsInFuture = new Date(update.membershipEnd) > new Date();
      if (endsInFuture && req.body.membershipStatus === undefined) {
        update.membershipStatus = 'active';
      }
    } else {
      if (update.feePaid === true && update.feeDueAmount === undefined) {
        update.feeDueAmount = 0;
      } else if (update.feePaid === false && (update.feeDueAmount === undefined || update.feeDueAmount === 0)) {
        const fee = update.feeAmount !== undefined ? Number(update.feeAmount) : Number(current.feeAmount || 0);
        update.feeDueAmount = fee;
      }
    }

    const session = await mongoose.startSession();
    let member;
    try {
      await session.withTransaction(async () => {
        member = await User.findByIdAndUpdate(req.params.id, update, {
          new: true,
          runValidators: true,
          context: 'query',
          session,
        }).select('-password');
        if (!member) {
          const e = new Error('Member not found'); e.status = 404; throw e;
        }

        if (endMoved && Number(req.body.initialPayment || 0) > 0) {
          const key = `renewal:${member._id}:${new Date(member.membershipEnd).toISOString()}:${Number(req.body.initialPayment)}`;
          try {
            await Payment.create([{
              member: member._id,
              source: 'membership',
              kind: current.membershipEnd ? 'renewal' : 'new-membership',
              amount: Number(req.body.initialPayment),
              method: req.body.paymentMethod || 'cash',
              periodStart: member.membershipStart,
              periodEnd: member.membershipEnd,
              recordedBy: req.user._id,
              idempotencyKey: key,
              note: current.membershipEnd ? 'Membership renewal' : 'Joining fee',
            }], { session });
          } catch (err) {
            if (err?.code !== 11000) throw err;
          }
        }
      });
    } catch (err) {
      if (err?.status === 404) return res.status(404).json({ message: err.message });
      throw err;
    } finally {
      await session.endSession();
    }

    cache.del(`user:${req.params.id}`);
    cache.del(`member:profile:${req.params.id}`);
    bustMembersCache();
    invalidateAnalytics();
    res.json(member);
  } catch (err) { sendDbError(res, err, 'Could not save this member.'); }
});

// DELETE /api/members/:id
const deleteMember = asyncHandler(async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Member not found' });

    const id = req.params.id;
    const [notifs, progress, planners] = await Promise.all([
      Notification.deleteMany({ member: id }),
      ProgressEntry.deleteMany({ member: id }),
      WorkoutSplit.deleteMany({ member: id }),
      Exercise.updateMany({ assignedTo: id }, { $pull: { assignedTo: id } }),
      DietPlan.updateMany({ assignedTo: id }, { $pull: { assignedTo: id } }),
    ]);

    cache.del(`user:${id}`);
    cache.del(`member:profile:${id}`);
    bustMembersCache();
    cache.delPattern('notifs:');
    cache.delPattern('split:');
    invalidateAnalytics();

    res.json({
      message: 'Member deleted',
      alsoRemoved: {
        notifications: notifs.deletedCount,
        progressEntries: progress.deletedCount,
        workoutPlans: planners.deletedCount,
      },
    });
  } catch (err) { sendDbError(res, err, 'Could not delete this member.'); }
});

// PATCH /api/members/:id/role
const updateMemberRole = asyncHandler(async (req, res) => {
  try {
    const { role } = req.body;
    const VALID = ['admin', 'trainer', 'member'];
    if (!VALID.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${VALID.join(', ')}` });
    }

    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({ message: 'You cannot change your own role.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === role) {
      return res.status(200).json({ message: `Already a ${role}.`, user: { ...user.toObject(), password: undefined } });
    }

    if (user.role === 'admin' && role !== 'admin') {
      const admins = await User.countDocuments({ role: 'admin' });
      if (admins <= 1) {
        return res.status(400).json({ message: 'This is the only admin. Promote someone else first.' });
      }
    }

    user.role = role;
    await user.save();

    cache.del(`user:${user._id}`);
    bustMembersCache();
    cache.del('trainers:active');
    invalidateAnalytics();

    const safe = user.toObject(); delete safe.password;
    res.json({ message: `${user.name} is now a ${role}.`, user: safe });
  } catch (err) { sendDbError(res, err, 'Could not change this role.'); }
});

// POST /api/members/:id/reminder
const sendIndividualReminder = asyncHandler(async (req, res) => {
  try {
    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const { channels = ['whatsapp', 'email', 'website'], customMessage } = req.body || {};
    const daysLeft = member.membershipEnd
      ? (daysRemaining(member.membershipEnd, Date.now()) ?? 0)
      : 0;

    const text = customMessage || buildReminderText(member);
    const summary = await notifyMember(member, {
      type: 'fee-reminder',
      title: daysLeft <= 0 ? 'Membership expired' : 'Membership renewal reminder',
      subject: `Membership renewal reminder — ${BRAND}`,
      message: text,
      customerName: member.name,
      daysRemaining: daysLeft,
      isGymReminder: true,
      ctaText: 'Renew now',
      ctaUrl: `${process.env.FRONTEND_URL || SITE_URL}/plans`,
    }, { channels });

    const delivered = summary?.delivered || [];
    const failed = summary?.failed || [];

    if (delivered.includes('whatsapp')) {
      await User.updateOne({ _id: member._id }, { $set: { lastWhatsAppAt: new Date() } });
      bustMembersCache();
    }

    const channelLabels = delivered.map(c => (c === 'whatsapp' ? 'WhatsApp (Meta Template)' : c === 'email' ? 'Email' : 'In-App'));

    res.json({
      message: channelLabels.length
        ? `Reminder sent to ${member.name} via ${channelLabels.join(' & ')}.`
        : 'Reminder saved in-app (external channels could not deliver).',
      delivered,
      failed,
      results: summary?.results,
    });
  } catch (err) { sendDbError(res, err, 'Could not send this reminder.'); }
});

// POST /api/members/run-reminders
const runRemindersSweep = asyncHandler(async (req, res) => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 7 * 86400000);
    const members = await User.find({
      role: 'member',
      isActive: { $ne: false },
      membershipStatus: 'active',
      membershipEnd: { $gte: now, $lte: cutoff },
    }).lean();
    const summary = await notifyMembers(members, member => {
      const daysLeft = daysRemaining(member.membershipEnd, now) ?? 0;
      return {
        type: 'fee-reminder',
        title: daysLeft === 0 ? 'Membership ends today' : `Membership ends in ${daysLeft} day(s)`,
        subject: `Your ${BRAND} membership expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`}`,
        message: `Dear ${member.name}, your ${BRAND} membership expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`} on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Renew now to keep training without a break.`,
        customerName: member.name,
        daysRemaining: daysLeft,
        isGymReminder: true,
        ctaText: 'Renew membership',
        ctaUrl: `${process.env.FRONTEND_URL || SITE_URL}/plans`,
      };
    }, { channels: ['email'] });
    res.json({
      message: `Email sent to ${summary.email} member(s).`,
      count: summary.email,
      ...summary,
    });
  } catch (err) { sendDbError(res, err, 'Could not run the reminder sweep.'); }
});

// POST /api/members/bulk-reminder
const sendBulkReminder = asyncHandler(async (req, res) => {
  try {
    const { days = 7, customMessage, channels = ['whatsapp', 'email'] } = req.body;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);

    const members = await User.find({
      role: 'member',
      isActive: { $ne: false },
      membershipStatus: 'active',
      membershipEnd: { $gte: now, $lte: cutoff }
    }).lean();

    if (!members.length) {
      return res.json({ message: `No active members found expiring within ${days} days.`, sent: 0, count: 0 });
    }

    const renewUrl = `${process.env.FRONTEND_URL || SITE_URL}/plans`;
    const summary = await notifyMembers(members, member => {
      const daysLeft = daysRemaining(member.membershipEnd, now) ?? 0;
      const msg = customMessage ||
        `Dear ${member.name}, your ${BRAND} membership expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`} on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Renew now to keep training without a break.`;
      return {
        type: 'fee-reminder',
        title: daysLeft === 0 ? 'Membership ends today' : `Membership ends in ${daysLeft} day(s)`,
        subject: `Your ${BRAND} membership expires ${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`}`,
        message: msg,
        customerName: member.name,
        daysRemaining: daysLeft,
        isGymReminder: true,
        ctaText: 'Renew membership',
        ctaUrl: renewUrl,
      };
    }, { channels });

    if (channels.includes('whatsapp')) {
      const ids = members.map(m => m._id);
      await User.updateMany({ _id: { $in: ids } }, { $set: { lastWhatsAppAt: new Date() } });
      bustMembersCache();
    }

    res.json({
      message: `Dispatched to ${summary.sent} member(s) — Meta WhatsApp: ${summary.whatsapp}, Email: ${summary.email}`,
      count: summary.sent,
      ...summary,
    });
  } catch (err) { sendDbError(res, err); }
});

// POST /api/members/:id/send-notification
const sendMemberNotification = asyncHandler(async (req, res) => {
  try {
    const { title, message, type = 'general', sendWhatsApp: doWA, sendEmail: doEmail, channels } = req.body;
    if (!title || !message) return res.status(400).json({ message: 'Title and message required' });

    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const picked = channels || [
      'website',
      ...(doWA === false ? [] : ['whatsapp']),
      ...(doEmail === false ? [] : ['email']),
    ];

    const { notification, results, delivered, failed } =
      await notifyMember(member, { type, title, message }, { channels: picked });

    res.json({
      message: delivered.length
        ? `Notification sent via ${['website', ...delivered].join(', ')}`
        : 'Notification saved in-app; no external channel delivered',
      notif: notification,
      delivered,
      failed,
      results,
    });
  } catch (err) { sendDbError(res, err); }
});

module.exports = {
  getRoster,
  getMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  updateMemberRole,
  sendIndividualReminder,
  runRemindersSweep,
  sendBulkReminder,
  sendMemberNotification,
};
