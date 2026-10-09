const Notification = require('../models/Notification.model');
const User = require('../models/User.model');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { notifyMember, notifyMembers, channelHealth, notifKey } = require('../services/notify');
const { daysRemaining } = require('../utils/dateUtils');
const { sendDbError } = require('../utils/dbError');

const NOTIF_TTL = 30;
const ADMIN_FEED_KEY = 'notifs:admin:all';

// GET /api/notifications — user's own notifications
const getMyNotifications = asyncHandler(async (req, res) => {
  try {
    const key = notifKey(req.user._id);
    const notifs = await cache.getOrSet(key, NOTIF_TTL, () =>
      Notification.find({ member: req.user._id }).sort({ createdAt: -1 }).limit(50).lean()
    );
    res.json(notifs);
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/notifications/admin/all — admin: all notifications
const getAllNotificationsAdmin = asyncHandler(async (req, res) => {
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
    sendDbError(res, err);
  }
});

// PUT /api/notifications/admin/mark-all-read — admin: mark all as read
const markAllReadAdmin = asyncHandler(async (req, res) => {
  try {
    await Notification.updateMany({ isRead: false }, { isRead: true });
    cache.del(ADMIN_FEED_KEY);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/notifications/admin/channels — is WhatsApp/email actually configured?
const getChannelHealth = asyncHandler(async (req, res) => {
  res.json(channelHealth());
});

// POST /api/notifications/admin/test — send a test message
const sendTestNotification = asyncHandler(async (req, res) => {
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
        type: 'fee-reminder',
        title: 'Test notification',
        message: `This is a test from your gym dashboard, sent at ${new Date().toLocaleString('en-IN')}. If you can read this on WhatsApp and in your inbox, both channels are live.`,
        customerName: req.user.name || 'Admin',
        daysRemaining: 5,
        isGymReminder: true,
      },
      { channels: req.body.channels || ['whatsapp', 'email'], persist: false }
    );
    res.json({ delivered, failed, results, health: channelHealth() });
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/notifications/admin/send — admin: send to one member or broadcast
const sendAdminNotification = asyncHandler(async (req, res) => {
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
      const left = member.membershipEnd
        ? (daysRemaining(member.membershipEnd, Date.now()) ?? 0)
        : 0;
      const { notification, results, delivered, failed } =
        await notifyMember(member, {
          type,
          title,
          message,
          customerName: member.name,
          daysRemaining: left,
          isGymReminder: true,
        }, { channels: picked });
      if (delivered.includes('whatsapp')) {
        await User.updateOne({ _id: member._id }, { $set: { lastWhatsAppAt: new Date() } });
      }
      cache.del(ADMIN_FEED_KEY);
      return res.json({ ...(notification ? notification.toObject() : {}), delivered, failed, results });
    }

    const now = new Date();
    let query = { role: 'member', isActive: { $ne: false } };

    if (req.body.target === 'expiring_2d') {
      const in2Days = new Date(now.getTime() + 2 * 86400000);
      query.membershipStatus = 'active';
      query.membershipEnd = { $gte: now, $lte: in2Days };
    } else if (req.body.target === 'expiring_7d') {
      const in7Days = new Date(now.getTime() + 7 * 86400000);
      query.membershipStatus = 'active';
      query.membershipEnd = { $gte: now, $lte: in7Days };
    } else if (req.body.target === 'expired') {
      query.membershipStatus = 'expired';
    } else if (Array.isArray(req.body.memberIds) && req.body.memberIds.length) {
      query._id = { $in: req.body.memberIds };
    }

    const members = await User.find(query)
      .select('_id name email phone whatsapp notifyEmail notifyWhatsApp membershipEnd')
      .lean();

    if (!members.length) {
      return res.json({ message: 'No members match the selected audience filter.', sent: 0, count: 0 });
    }

    const summary = await notifyMembers(
      members,
      member => {
        const left = member.membershipEnd
          ? (daysRemaining(member.membershipEnd, now) ?? 0)
          : 0;
        return {
          type,
          title,
          message,
          subject: `${title} — FitNation`,
          customerName: member.name,
          daysRemaining: left,
          isGymReminder: true,
        };
      },
      {
        channels: picked,
        concurrency: Number(process.env.BROADCAST_CONCURRENCY || 8),
      }
    );

    if (picked.includes('whatsapp')) {
      const ids = members.map(m => m._id);
      await User.updateMany({ _id: { $in: ids } }, { $set: { lastWhatsAppAt: new Date() } });
    }

    cache.delPattern('notifs:member:');
    cache.del(ADMIN_FEED_KEY);

    res.json({
      message: `Sent to ${summary.sent} member(s) — Meta WhatsApp: ${summary.whatsapp}, Email: ${summary.email}`,
      ...summary,
    });
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/notifications/read-all — user: mark all own as read
const markAllReadUser = asyncHandler(async (req, res) => {
  try {
    await Notification.updateMany({ member: req.user._id, isRead: false }, { isRead: true });
    cache.del(ADMIN_FEED_KEY);
    cache.del(notifKey(req.user._id));
    res.json({ message: 'All marked as read' });
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/notifications/:id/read
const markRead = asyncHandler(async (req, res) => {
  try {
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
    sendDbError(res, err);
  }
});

// DELETE /api/notifications/admin/:id — remove one notification
const deleteNotificationAdmin = asyncHandler(async (req, res) => {
  try {
    const gone = await Notification.findByIdAndDelete(req.params.id);
    if (!gone) return res.status(404).json({ message: 'Notification not found' });
    cache.del(ADMIN_FEED_KEY);
    if (gone.member) cache.del(`notifs:member:${gone.member}`);
    res.json({ message: 'Notification deleted.' });
  } catch (err) { sendDbError(res, err); }
});

// DELETE /api/notifications/admin — clear history in bulk
const clearNotificationsBulkAdmin = asyncHandler(async (req, res) => {
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
  } catch (err) { sendDbError(res, err); }
});

module.exports = {
  getMyNotifications,
  getAllNotificationsAdmin,
  markAllReadAdmin,
  getChannelHealth,
  sendTestNotification,
  sendAdminNotification,
  markAllReadUser,
  markRead,
  deleteNotificationAdmin,
  clearNotificationsBulkAdmin,
};
