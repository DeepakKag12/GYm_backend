const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/notifications — user's own notifications
router.get('/', protect, async (req, res) => {
  try {
    const notifs = await Notification.find({ member: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/notifications/admin/all — admin: all notifications (populated with member name)
router.get('/admin/all', protect, adminOnly, async (req, res) => {
  try {
    const notifs = await Notification
      .find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('member', 'name email');
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/admin/mark-all-read — admin: mark all as read
router.put('/admin/mark-all-read', protect, adminOnly, async (req, res) => {
  try {
    await Notification.updateMany({ isRead: false }, { isRead: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/notifications/admin/send — admin: send notification to member or broadcast
router.post('/admin/send', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, type = 'announcement', memberId } = req.body;
    if (!title || !message) return res.status(400).json({ message: 'Title and message required' });

    if (memberId) {
      // Send to specific member
      const notif = await Notification.create({ member: memberId, title, message, type, sentVia: ['website'] });
      return res.json(notif);
    }

    // Broadcast to all members
    const members = await User.find({ role: 'member' }, '_id');
    const docs = members.map(m => ({ member: m._id, title, message, type, sentVia: ['website'] }));
    await Notification.insertMany(docs);
    res.json({ message: `Sent to ${members.length} members` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/read-all — user: mark all own as read (must be before /:id)
router.put('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ member: req.user._id, isRead: false }, { isRead: true });
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', protect, async (req, res) => {
  try {
    const notif = await Notification.findByIdAndUpdate(req.params.id, { isRead: true }, { new: true });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
