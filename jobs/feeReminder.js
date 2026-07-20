const cron = require('node-cron');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendWhatsApp } = require('../utils/whatsapp');

// Run every day at 9:00 AM
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ Running fee reminder cron job...');
  const now = new Date();

  const members = await User.find({
    role: 'member',
    membershipStatus: 'active',
    membershipEnd: { $exists: true }
  });

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
      message = `Dear ${member.name}, your FitnessByAjeet membership has expired. Please renew to continue your fitness journey. Contact us: ${process.env.ADMIN_WHATSAPP}`;
      member.membershipStatus = 'expired';
      member.reminderSentExpiry = true;
    } else if (daysLeft <= 3 && daysLeft > 0 && !member.reminderSent3days) {
      shouldNotify = true;
      title = '⚠️ Membership Expiring Soon';
      message = `Dear ${member.name}, your FitnessByAjeet membership is expiring in ${daysLeft} day(s) on ${new Date(member.membershipEnd).toLocaleDateString()}. Renew now to avoid interruption!`;
      member.reminderSent3days = true;
    } else if (daysLeft <= 7 && daysLeft > 3 && !member.reminderSent7days) {
      shouldNotify = true;
      title = '📅 Membership Reminder';
      message = `Dear ${member.name}, your FitnessByAjeet membership expires in ${daysLeft} days on ${new Date(member.membershipEnd).toLocaleDateString()}. Plan your renewal today!`;
      member.reminderSent7days = true;
    }

    if (shouldNotify) {
      // Save website notification first
      const notif = await Notification.create({ member: member._id, type: notifType, title, message, sentVia: ['website'] });

      // WhatsApp notification — fall back to phone if whatsapp field is empty
      const waNum = member.whatsapp || member.phone;
      if (waNum) {
        const sent = await sendWhatsApp(waNum, `*FitnessByAjeet*\n\n${message}`);
        if (sent) {
          notif.sentVia.push('whatsapp');
          await notif.save();
        }
      }
      await member.save();
      console.log(`✅ Reminder sent to ${member.name} (${daysLeft} days left)`);
    }
  }
});

console.log('🔔 Fee reminder cron job scheduled');
