/**
 * /api/cron/fee-reminder
 *
 * Called by Vercel Cron (schedule defined in vercel.json) every day at 9 AM UTC.
 * Also works as a regular HTTP GET — protected by CRON_SECRET so only Vercel
 * (or the admin) can trigger it manually.
 *
 * Set CRON_SECRET=<some_random_string> in your Vercel environment variables.
 * Vercel automatically passes it as the Authorization: Bearer <secret> header.
 */
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendWhatsApp } = require('../utils/whatsapp');

router.get('/fee-reminder', async (req, res) => {
  // Verify secret so random people can't spam-trigger reminders
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
  }

  try {
    const now = new Date();

    const members = await User.find({
      role: 'member',
      membershipStatus: 'active',
      membershipEnd: { $exists: true }
    });

    let notified = 0;

    for (const member of members) {
      const daysLeft = Math.ceil((new Date(member.membershipEnd) - now) / (1000 * 60 * 60 * 24));
      let shouldNotify = false;
      let notifType = 'fee-reminder';
      let title = '';
      let message = '';

      if (daysLeft <= 0 && !member.reminderSentExpiry) {
        shouldNotify = true;
        notifType = 'membership-expired';
        title = '🚨 Membership Expired';
        message = `Dear ${member.name}, your FitNation by Ajeet membership has expired. Please renew to continue your fitness journey. Contact us: ${process.env.ADMIN_WHATSAPP || ''}`;
        member.membershipStatus = 'expired';
        member.reminderSentExpiry = true;
      } else if (daysLeft <= 3 && daysLeft > 0 && !member.reminderSent3days) {
        shouldNotify = true;
        title = '⚠️ Membership Expiring Soon';
        message = `Dear ${member.name}, your FitNation by Ajeet membership is expiring in ${daysLeft} day(s) on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Renew now to avoid interruption!`;
        member.reminderSent3days = true;
      } else if (daysLeft <= 7 && daysLeft > 3 && !member.reminderSent7days) {
        shouldNotify = true;
        title = '📅 Membership Reminder';
        message = `Dear ${member.name}, your FitNation by Ajeet membership expires in ${daysLeft} days on ${new Date(member.membershipEnd).toLocaleDateString('en-IN')}. Plan your renewal today!`;
        member.reminderSent7days = true;
      }

      if (shouldNotify) {
        const notif = await Notification.create({ member: member._id, type: notifType, title, message, sentVia: ['website'] });

        const waNum = member.whatsapp || member.phone;
        if (waNum) {
          const sent = await sendWhatsApp(waNum, `*FITNATION BY AJEET*\n\n${message}`);
          if (sent) {
            notif.sentVia.push('whatsapp');
            await notif.save();
          }
        }
        await member.save();
        notified++;
      }
    }

    console.log(`✅ Cron fee-reminder: notified ${notified} member(s)`);
    res.json({ ok: true, notified });
  } catch (err) {
    console.error('❌ Cron fee-reminder error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
