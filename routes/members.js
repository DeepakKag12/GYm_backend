const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { notifyMember, notifyMembers } = require('../services/notify');
const { sendDbError } = require('../utils/dbError');
const { findDuplicate } = require('../utils/duplicateUser');
const Notification = require('../models/Notification');
const ProgressEntry = require('../models/ProgressEntry');
const WorkoutSplit = require('../models/WorkoutSplit');
const Exercise = require('../models/Exercise');
const DietPlan = require('../models/DietPlan');
const { BRAND, SITE_URL } = require('../utils/emailTemplate');
const { runFeeReminderSweep, daysRemaining } = require('../services/feeReminder');
const Payment = require('../models/Payment');
const cache = require('../utils/cache');

/** Bust all analytics cache keys when member data changes */
function invalidateAnalytics() {
  cache.delPattern('analytics:');
}

/** Welcome the new member on every channel at once (in-app + WhatsApp + email). */
async function sendWelcome(member, { usedPhoneAsPassword } = {}) {
  const loginUrl = `${process.env.FRONTEND_URL || SITE_URL}/login`;

  // The password is never put in this message.
  //
  // It used to be, which meant the member's credentials travelled in plain text
  // through email and sat in whatever inbox received them, forever. When the
  // password is simply their own mobile number there is no secret to send —
  // they already know it. When an admin chose a custom one, the admin hands it
  // over directly from the "User created" dialog.
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

/* ── helpers ── */
const PLAN_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 };

function calcExpiry(startDate, plan) {
  if (!startDate || !plan) return null;
  const d = new Date(startDate);
  const months = PLAN_MONTHS[plan] || 1;
  d.setMonth(d.getMonth() + months);
  return d;
}

const MEMBERS_CACHE_KEY = 'members:all';

// GET /api/members
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const members = await cache.getOrSet(MEMBERS_CACHE_KEY, 60, () =>
      // -password: this list was shipping every member's bcrypt hash to the
      // browser, where it also sat in the client-side cache.
      User.find({ role: 'member' })
        .select('-password')
        .populate('assignedTrainer', 'name phone')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(members);
  } catch (err) { sendDbError(res, err); }
});

// GET /api/members/:id — self, or any trainer/admin. Never exposes the hash.
// NOTE: cache key is deliberately NOT `user:<id>` — that namespace belongs to the
// `protect` middleware, and this payload is shaped differently (populated trainer).
router.get('/:id', protect, async (req, res) => {
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

// POST /api/members — Admin creates member
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const {
      name, email, phone, whatsapp, password,
      membershipPlan, membershipStart, membershipEnd,
      feeAmount, assignedTrainer, gender, dob, address
    } = req.body;

    // Email *or* phone — checking only the email let the same person be added
    // twice under a second address.
    const clash = await findDuplicate({ email, phone });
    if (clash) {
      return res.status(409).json({
        message: clash.message,
        field: clash.field,
        existingUser: { _id: clash.user._id, name: clash.user.name, role: clash.user.role },
      });
    }

    // Auto-calculate expiry if not provided
    const expiry = membershipEnd || calcExpiry(membershipStart, membershipPlan);

    // A blank password means "use their mobile number" — the number is already
    // required, and it gives the member something they can sign in with without
    // anyone having to transmit a secret.
    const usedPhoneAsPassword = !password;
    if (usedPhoneAsPassword && !phone) {
      return res.status(400).json({ message: 'Provide a password, or a mobile number to use as one.' });
    }
    const hashed = await bcrypt.hash(password || phone, 10);
    /**
     * The member and their joining fee are written together or not at all.
     *
     * Created separately, a failure banking the fee left a member on the books
     * whose money was never recorded — the accounts would quietly understate
     * income, and nothing would flag it.
     */
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
          feeAmount,
          assignedTrainer: assignedTrainer || undefined,
          gender, dob, address,
          membershipStatus: 'active',
          feePaid: true,
        }], { session });
        member = created;

        if (Number(feeAmount) > 0) {
          await Payment.create([{
            member: member._id,
            source: 'membership',
            kind: 'new-membership',
            amount: Number(feeAmount),
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
    cache.del(MEMBERS_CACHE_KEY);
    // Send welcome message (non-blocking)
    sendWelcome(member, { usedPhoneAsPassword }).catch(() => {});
    const safe = member.toObject(); delete safe.password;
    res.status(201).json(safe);
  } catch (err) { sendDbError(res, err, 'Could not create this member.'); }
});

// PUT /api/members/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    // Whitelist: `...req.body` allowed role escalation and wrote an unhashed
    // password straight to the document, silently breaking that member's login.
    const ALLOWED = [
      'name', 'email', 'phone', 'whatsapp', 'address', 'dob', 'gender', 'avatar',
      'membershipPlan', 'membershipStart', 'membershipEnd', 'membershipStatus',
      'feePaid', 'feeAmount', 'assignedTrainer', 'isActive',
    ];
    const update = {};
    for (const k of ALLOWED) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    // Editing must not hand this member somebody else's email or number.
    // excludeId keeps them from clashing with their own record.
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

    // Auto-calculate expiry whenever start+plan changes
    if (update.membershipStart && update.membershipPlan && !update.membershipEnd) {
      update.membershipEnd = calcExpiry(update.membershipStart, update.membershipPlan);
    }

    // Renewal handling. The flags are only touched when the end date actually
    // MOVES — resetting them on every edit meant that correcting a typo in
    // someone's name could make them receive the same reminder twice.
    const current = await User.findById(req.params.id).select('membershipEnd membershipStatus').lean();
    if (!current) return res.status(404).json({ message: 'Member not found' });

    const endMoved = update.membershipEnd !== undefined && (
      !current.membershipEnd ||
      new Date(update.membershipEnd).getTime() !== new Date(current.membershipEnd).getTime()
    );

    if (endMoved) {
      update.reminderSent7days  = false;
      update.reminderSent3days  = false;
      update.reminderSentExpiry = false;

      // An expired member given a future end date is a renewed member. Without
      // this they stayed marked "expired" — shown in red, still swept by the
      // expiry job — until someone changed the status by hand.
      const endsInFuture = new Date(update.membershipEnd) > new Date();
      if (endsInFuture && req.body.membershipStatus === undefined) {
        update.membershipStatus = 'active';
      }
    }

    /**
     * The membership change and the money it represents are one transaction.
     *
     * Written separately, a renewal could extend the period and then fail to
     * bank the fee — the member trains for another month and the books never
     * see it. Either both land or neither does.
     */
    const session = await mongoose.startSession();
    let member;
    try {
      await session.withTransaction(async () => {
        member = await User.findByIdAndUpdate(req.params.id, update, {
          new: true,
          // Without runValidators, findByIdAndUpdate skips the schema entirely:
          // membershipPlan: 'fortnightly' saved happily and broke the expiry
          // calculation later. `context: 'query'` is what makes enum checks apply
          // to an update rather than only to a new document.
          runValidators: true,
          context: 'query',
          session,
        }).select('-password');
        if (!member) {
          const e = new Error('Member not found'); e.status = 404; throw e;
        }

        if (endMoved && req.body.feePaid !== false && Number(req.body.feeAmount) > 0) {
          // Keyed on member + new end date, so a resubmitted renewal cannot
          // bank the same fee twice even across separate requests.
          const key = `renewal:${member._id}:${new Date(member.membershipEnd).toISOString()}`;
          try {
            await Payment.create([{
              member: member._id,
              source: 'membership',
              kind: current.membershipEnd ? 'renewal' : 'new-membership',
              amount: Number(req.body.feeAmount),
              periodStart: member.membershipStart,
              periodEnd: member.membershipEnd,
              recordedBy: req.user._id,
              idempotencyKey: key,
              note: current.membershipEnd ? 'Membership renewal' : 'Joining fee',
            }], { session });
          } catch (err) {
            // 11000 means this exact renewal is already banked — the membership
            // update should still stand, so this one case is swallowed.
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

    // Bust cached user so the protect middleware picks up new data
    cache.del(`user:${req.params.id}`);
    cache.del(`member:profile:${req.params.id}`);
    cache.del(MEMBERS_CACHE_KEY);
    invalidateAnalytics();
    res.json(member);
  } catch (err) { sendDbError(res, err, 'Could not save this member.'); }
});

// DELETE /api/members/:id
// Removes the member AND the records that only make sense with them. Without
// this the database filled up with notifications and progress entries pointing
// at a user that no longer exists — they showed up in the admin feed as blank
// rows, and nothing could ever clean them up.
//
// Orders are deliberately KEPT: they are financial history and the revenue
// figures must still add up after someone leaves the gym.
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Member not found' });

    const id = req.params.id;
    const [notifs, progress, planners] = await Promise.all([
      Notification.deleteMany({ member: id }),
      ProgressEntry.deleteMany({ member: id }),
      WorkoutSplit.deleteMany({ member: id }),
      // Assigned content is shared, so the member is only removed from the list
      Exercise.updateMany({ assignedTo: id }, { $pull: { assignedTo: id } }),
      DietPlan.updateMany({ assignedTo: id }, { $pull: { assignedTo: id } }),
    ]);

    cache.del(`user:${id}`);
    cache.del(`member:profile:${id}`);
    cache.del(MEMBERS_CACHE_KEY);
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

// PATCH /api/members/:id/role — admin changes a user's role
//
// Deliberately its own endpoint rather than a field on PUT /:id. That handler
// whitelists its fields precisely so a role can never ride in on an ordinary
// profile update, and that protection stays intact. Role changes are rare,
// dangerous, and worth an explicit route with its own guards.
router.patch('/:id/role', protect, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    const VALID = ['admin', 'trainer', 'member'];
    if (!VALID.includes(role)) {
      return res.status(400).json({ message: `Role must be one of: ${VALID.join(', ')}` });
    }

    // An admin cannot change their own role. Without this, the only admin can
    // demote themselves and lock the gym out of its own panel with no way back.
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({ message: 'You cannot change your own role.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === role) {
      return res.status(200).json({ message: `Already a ${role}.`, user: { ...user.toObject(), password: undefined } });
    }

    // Never let the last admin be demoted — same lockout risk as above, just
    // one step removed.
    if (user.role === 'admin' && role !== 'admin') {
      const admins = await User.countDocuments({ role: 'admin' });
      if (admins <= 1) {
        return res.status(400).json({ message: 'This is the only admin. Promote someone else first.' });
      }
    }

    user.role = role;
    await user.save();

    // `protect` caches the user for 5 minutes; without this the new role would
    // not take effect until that expired.
    cache.del(`user:${user._id}`);
    cache.del(MEMBERS_CACHE_KEY);
    cache.del('trainers:active');   // the user may have moved in or out of the trainer list
    invalidateAnalytics();

    const safe = user.toObject(); delete safe.password;
    res.json({ message: `${user.name} is now a ${role}.`, user: safe });
  } catch (err) { sendDbError(res, err, 'Could not change this role.'); }
});

/**
 * Text of the renewal reminder for one member, independent of the scheduler.
 *
 * planReminder() deliberately returns null when a member is not due (wrong slot,
 * already sent, too far out). An admin pressing "Send reminder" wants the
 * message regardless, so the wording is built here and shared by both paths.
 */
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

/** wa.me deep link — opens the admin's own WhatsApp with the text pre-filled. */
function whatsappLinkFor(member, text) {
  const digits = String(member.whatsapp || member.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const e164 = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

// POST /api/members/:id/reminder — admin sends one renewal reminder now.
//
// Email and the in-app notification are dispatched here and now. WhatsApp is
// returned as a wa.me link rather than sent, because the automated channel needs
// a registered WhatsApp sender; the link works today from the admin's own phone.
router.post('/:id/reminder', protect, adminOnly, async (req, res) => {
  try {
    const member = await User.findById(req.params.id).lean();
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const text = buildReminderText(member);
    const summary = await notifyMember(member, {
      type: 'fee-reminder',
      title: 'Membership renewal reminder',
      subject: `Membership renewal reminder — ${BRAND}`,
      message: text,
      ctaText: 'Renew now',
      ctaUrl: `${process.env.FRONTEND_URL || SITE_URL}/plans`,
    });

    const whatsappUrl = whatsappLinkFor(member, text);

    // Stamped only when there is actually a chat to open. Recording a handoff
    // for a member with no number would make the "still to contact" list lie.
    if (whatsappUrl) {
      await User.updateOne({ _id: member._id }, { $set: { lastWhatsAppAt: new Date() } });
      cache.del(MEMBERS_CACHE_KEY);
    }

    res.json({
      message: `Reminder emailed to ${member.name}.`,
      text,
      whatsappUrl,
      whatsappOpenedAt: whatsappUrl ? new Date() : null,
      delivered: summary?.channels || summary || null,
    });
  } catch (err) { sendDbError(res, err, 'Could not send this reminder.'); }
});

// POST /api/members/run-reminders — admin runs the whole sweep on demand.
router.post('/run-reminders', protect, adminOnly, async (req, res) => {
  try {
    // Keep older frontend builds working: this is the admin's manual "email
    // everyone expiring" action, so it must not inherit the cron sweep's
    // per-slot idempotency and skip members already reminded today.
    const now = new Date();
    const cutoff = new Date(now.getTime() + 7 * 86400000);
    const members = await User.find({
      role: 'member',
      isActive: { $ne: false },
      membershipStatus: 'active',
      membershipEnd: { $gte: now, $lte: cutoff },
    });
    const summary = await notifyMembers(members, member => {
      const daysLeft = Math.ceil((new Date(member.membershipEnd) - now) / 86400000);
      return {
        type: 'fee-reminder',
        title: `Membership ends in ${daysLeft} day(s)`,
        subject: `Your ${BRAND} membership expires in ${daysLeft} day(s)`,
        message: `Dear ${member.name}, your ${BRAND} membership expires in ${daysLeft} day(s) on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Renew now to keep training without a break.`,
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

// POST /api/members/bulk-reminder — Send reminder to all expiring members
// NOTE: must be defined BEFORE /:id routes so Express doesn't treat "bulk-reminder" as an :id
router.post('/bulk-reminder', protect, adminOnly, async (req, res) => {
  try {
    const { days = 7, customMessage, channels } = req.body;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);

    const members = await User.find({
      role: 'member',
      membershipStatus: 'active',
      membershipEnd: { $gte: now, $lte: cutoff }
    });

    const renewUrl = `${process.env.FRONTEND_URL || SITE_URL}/plans`;
    // One dispatch per member, WhatsApp + email in parallel, 5 members at a time.
    const summary = await notifyMembers(members, member => {
      const daysLeft = Math.ceil((new Date(member.membershipEnd) - now) / 86400000);
      const msg = customMessage ||
        `Dear ${member.name}, your ${BRAND} membership expires in ${daysLeft} day(s) on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Renew now to keep training without a break.`;
      return {
        type: 'fee-reminder',
        title: `Membership ends in ${daysLeft} day(s)`,
        subject: `Your ${BRAND} membership expires in ${daysLeft} day(s)`,
        message: msg,
        ctaText: 'Renew membership',
        ctaUrl: renewUrl,
      };
    }, { channels });

    res.json({
      message: `Reminder sent to ${summary.sent} member(s) — WhatsApp ${summary.whatsapp}, Email ${summary.email}`,
      count: summary.sent,
      ...summary,
    });
  } catch (err) { sendDbError(res, err); }
});

// POST /api/members/:id/send-notification — manual push on every channel at once.
// Body: { title, message, sendWhatsApp?, sendEmail?, channels?, type? }
// Both external channels default to ON; pass sendWhatsApp:false / sendEmail:false
// (or an explicit `channels` array) to narrow it.
router.post('/:id/send-notification', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, type = 'general', sendWhatsApp: doWA, sendEmail: doEmail, channels } = req.body;
    if (!title || !message) return res.status(400).json({ message: 'Title and message required' });

    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    // Explicit `channels` wins; otherwise the two booleans, each defaulting to true.
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

module.exports = router;
