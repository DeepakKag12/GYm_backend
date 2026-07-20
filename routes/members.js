const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const { sendWhatsApp } = require('../utils/whatsapp');
const cache = require('../utils/cache');

/** Bust all analytics cache keys when member data changes */
function invalidateAnalytics() {
  cache.delPattern('analytics:');
}

/** Send a welcome notification + WhatsApp when a member is created */
async function sendWelcome(member, password) {
  const title = '🎉 Welcome to FitNation by Ajeet!';
  const message = `Hi ${member.name}! Your membership is now active.\n\nLogin at: ${process.env.FRONTEND_URL || 'https://gym-web-ten-puce.vercel.app'}/login\nEmail: ${member.email}\nPassword: ${password}\n\nWe're excited to have you with us! 💪`;
  await Notification.create({ member: member._id, type: 'general', title, message, sentVia: ['website'] });
  if (member.whatsapp || member.phone) {
    const waNum = member.whatsapp || member.phone;
    await sendWhatsApp(waNum, `*FITNATION BY AJEET*\n\n${message}`).catch(() => {});
  }
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
      User.find({ role: 'member' })
        .populate('assignedTrainer', 'name phone')
        .sort({ createdAt: -1 })
        .lean()
    );
    res.json(members);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/members/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const key = `user:${req.params.id}`;
    const member = await cache.getOrSet(key, 120, () =>
      User.findById(req.params.id).populate('assignedTrainer', 'name phone').lean()
    );
    if (!member) return res.status(404).json({ message: 'Member not found' });
    res.json(member);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/members — Admin creates member
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const {
      name, email, phone, whatsapp, password,
      membershipPlan, membershipStart, membershipEnd,
      feeAmount, assignedTrainer, gender, dob, address
    } = req.body;

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    // Auto-calculate expiry if not provided
    const expiry = membershipEnd || calcExpiry(membershipStart, membershipPlan);

    const hashed = await bcrypt.hash(password || phone, 10);
    const member = await User.create({
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
    });
    invalidateAnalytics();
    cache.del(MEMBERS_CACHE_KEY);
    // Send welcome message (non-blocking)
    sendWelcome(member, password || phone).catch(() => {});
    res.status(201).json(member);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/members/:id
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const update = { ...req.body };

    // Auto-calculate expiry whenever start+plan changes
    if (update.membershipStart && update.membershipPlan && !update.membershipEnd) {
      update.membershipEnd = calcExpiry(update.membershipStart, update.membershipPlan);
    }

    // Reset reminder flags on renewal
    if (update.membershipEnd) {
      update.reminderSent7days  = false;
      update.reminderSent3days  = false;
      update.reminderSentExpiry = false;
    }

    const member = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!member) return res.status(404).json({ message: 'Member not found' });
    // Bust cached user so the protect middleware picks up new data
    cache.del(`user:${req.params.id}`);
    cache.del(MEMBERS_CACHE_KEY);
    invalidateAnalytics();
    res.json(member);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/members/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    cache.del(`user:${req.params.id}`);
    cache.del(MEMBERS_CACHE_KEY);
    invalidateAnalytics();
    res.json({ message: 'Member deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/members/:id/send-notification — Manual WhatsApp + website notification
router.post('/:id/send-notification', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, sendWhatsApp: doWA } = req.body;
    const member = await User.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    const notif = await Notification.create({
      member: member._id, type: 'general', title, message, sentVia: ['website']
    });

    if (doWA && member.whatsapp) {
      const waMsg = `*FITNATION BY AJEET*\n\n*${title}*\n\n${message}\n\n_Powered by FitNation_`;
      await sendWhatsApp(member.whatsapp, waMsg);
      notif.sentVia.push('whatsapp');
      await notif.save();
    }
    res.json({ message: 'Notification sent', notif });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/members/bulk-reminder — Send reminder to all expiring members
router.post('/bulk-reminder', protect, adminOnly, async (req, res) => {
  try {
    const { days = 7, customMessage } = req.body;
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 86400000);

    const members = await User.find({
      role: 'member',
      membershipStatus: 'active',
      membershipEnd: { $gte: now, $lte: cutoff }
    });

    let sent = 0;
    for (const member of members) {
      const daysLeft = Math.ceil((new Date(member.membershipEnd) - now) / 86400000);
      const msg = customMessage ||
        `Dear ${member.name}, your FITNATION BY AJEET membership expires in ${daysLeft} day(s) on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Contact us to renew: wa.me/${process.env.GYM_WHATSAPP}`;

      await Notification.create({
        member: member._id,
        type: 'fee-reminder',
        title: `⚠️ Membership expiring in ${daysLeft} day(s)`,
        message: msg,
        sentVia: ['website'],
      });

      if (member.whatsapp) {
        await sendWhatsApp(member.whatsapp, `*FITNATION BY AJEET*\n\n${msg}`);
      }
      sent++;
    }
    res.json({ message: `Reminder sent to ${sent} member(s)`, count: sent });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
