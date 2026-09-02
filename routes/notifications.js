const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');
const { notifyMember, notifyMembers, channelHealth, notifKey } = require('../services/notify');

// TTL = 30 s — short so unread badge stays fresh, but avoids hammering DB
// on every page navigation where Navbar + BottomNav both call this.
const NOTIF_TTL = 30;

// GET /api/notifications — user's own notifications
router.get('/', protect, async (req, res) => {
  try {
    const key = notifKey(req.user._id);
    const notifs = await cache.getOrSet(key, NOTIF_TTL, () =>
      Notification.find({ member: req.user._id }).sort({ createdAt: -1 }).limit(50).lean()
    );
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const ADMIN_FEED_KEY = 'notifs:admin:all';

// GET /api/notifications/admin/all — admin: all notifications (populated with member name)
// Cached briefly with stale-while-revalidate: the feed is polled by the admin
// screen, is expensive (200 docs + a populate), and is never time-critical.
router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    const notifs = await cache.getOrSet(ADMIN_FEED_KEY, 30, () =>
      Notification
        .find({})
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('member', 'name email')
        .lean(),
      { swr: 60 }
    );
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/admin/mark-all-read — admin: mark all as read
router.put('/admin/mark-all-read', protect, adminOnly, async (req, res) => {
  try {
    await Notification.updateMany({ isRead: false }, { isRead: true });
    cache.del(ADMIN_FEED_KEY);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/notifications/admin/channels — is WhatsApp/email actually configured?
// Check this first when "notifications aren't arriving"; it reports the exact
// missing env var instead of failing silently at send time.
router.get('/admin/channels', protect, adminOnly, (req, res) => {
  res.json(channelHealth());
});

// POST /api/notifications/admin/test — send a test message to yourself (or a
// given phone/email) to verify Twilio + SMTP end to end.
// Body: { phone?, email?, channels? }
router.post('/admin/test', protect, adminOnly, async (req, res) => {
  try {
    const target = {
      _id: req.user._id,
      name: req.user.name,
      email: req.body.email || req.user.email,
      phone: req.body.phone || req.user.phone,
      whatsapp: req.body.phone || req.user.whatsapp,
    };
    const { results, delivered, failed } = await notifyMember(
      target,
      {
        type: 'general',
        title: 'Test notification',
        message: `This is a test from your gym dashboard, sent at ${new Date().toLocaleString('en-IN')}. If you can read this on WhatsApp and in your inbox, both channels are live.`,
      },
      { channels: req.body.channels || ['whatsapp', 'email'], persist: false }
    );
    res.json({ delivered, failed, results, health: channelHealth() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/notifications/admin/send — admin: send to one member or broadcast.
// Delivered in-app AND over WhatsApp AND email at the same time.
// Body: { title, message, type?, memberId?, channels?, sendWhatsApp?, sendEmail? }
router.post('/admin/send', protect, adminOnly, async (req, res) => {
  try {
    const {
      title, message, type = 'announcement', memberId,
      channels, sendWhatsApp: doWA, sendEmail: doEmail,
    } = req.body;
    if (!title || !message) return res.status(400).json({ message: 'Title and message required' });

    const picked = channels || [
      'website',
      ...(doWA === false ? [] : ['whatsapp']),
      ...(doEmail === false ? [] : ['email']),
    ];

    if (memberId) {
      const member = await User.findById(memberId);
      if (!member) return res.status(404).json({ message: 'Member not found' });
      const { notification, results, delivered, failed } =
        await notifyMember(member, { type, title, message }, { channels: picked });
      cache.del(ADMIN_FEED_KEY);
      // `notification` is null when the caller opted out of the 'website' channel.
      return res.json({ ...(notification ? notification.toObject() : {}), delivered, failed, results });
    }

    // Broadcast. The fan-out is throttled so Twilio/SMTP aren't hit with 500 at
    // once. Rough budget: members / concurrency seconds — Vercel caps the request
    // at maxDuration (60 s in vercel.json), so raise BROADCAST_CONCURRENCY if your
    // roster outgrows that. In-app docs are written as the sweep goes, so even a
    // timed-out request leaves every processed member notified.
    const members = await User.find({ role: 'member', isActive: { $ne: false } })
      .select('_id name email phone whatsapp notifyEmail notifyWhatsApp');
    const summary = await notifyMembers(members, { type, title, message }, {
      channels: picked,
      concurrency: Number(process.env.BROADCAST_CONCURRENCY || 8),
    });
    cache.delPattern('notifs:member:');
    cache.del(ADMIN_FEED_KEY);

    res.json({
      message: `Sent to ${summary.sent} member(s) — WhatsApp ${summary.whatsapp}, Email ${summary.email}`,
      ...summary,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/read-all — user: mark all own as read (must be before /:id)
router.put('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ member: req.user._id, isRead: false }, { isRead: true });
    cache.del(ADMIN_FEED_KEY);
    cache.del(notifKey(req.user._id));
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', protect, async (req, res) => {
  try {
    // Scope to the caller's own notifications — this was an IDOR: any authenticated
    // user could mark another member's notification read by guessing its id.
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, member: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    cache.del(notifKey(req.user._id));
    cache.del(ADMIN_FEED_KEY);
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// DELETE /api/notifications/admin/:id — remove one notification
router.delete('/admin/:id', protect, adminOnly, async (req, res) => {
  try {
    const gone = await Notification.findByIdAndDelete(req.params.id);
    if (!gone) return res.status(404).json({ message: 'Notification not found' });
    cache.del(ADMIN_FEED_KEY);
    if (gone.member) cache.del(`notifs:member:${gone.member}`);
    res.json({ message: 'Notification deleted.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

/**
 * DELETE /api/notifications/admin — clear history in bulk.
 *
 * Scoped rather than all-or-nothing: `?member=<id>` clears one person's
 * history, `?before=<iso date>` prunes anything older than a date. With no
 * filter it refuses, because "delete everything" should be a deliberate act,
 * not what happens when a query string is forgotten.
 */
router.delete('/admin', protect, adminOnly, async (req, res) => {
  try {
    const { member, before, all } = req.query;
    const filter = {};
    if (member) filter.member = member;
    if (before) filter.createdAt = { $lt: new Date(before) };

    if (!member && !before && all !== 'true') {
      return res.status(400).json({
        message: 'Choose a member, a date, or pass all=true to clear everything.',
      });
    }

    const { deletedCount } = await Notification.deleteMany(filter);
    cache.del(ADMIN_FEED_KEY);
    cache.delPattern('notifs:member:');
    res.json({ message: `Deleted ${deletedCount} notification${deletedCount === 1 ? '' : 's'}.`, deletedCount });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
