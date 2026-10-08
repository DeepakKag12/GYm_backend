/**
 * Membership fee-reminder sweep — the single source of truth.
 *
 * This logic once existed twice, copy-pasted and already drifting:
 *   - routes/cron.js       (Vercel Cron, production)
 *   - jobs/feeReminder.js  (node-cron, local dev)
 * Both callers now delegate here.
 *
 * Delivery goes through services/notify.js, so each reminder lands in the app,
 * on WhatsApp, and in the member's inbox — sent in parallel, per member.
 */
const User = require('../models/User.model');
const { notifyMembers, adminWhatsAppNumber } = require('./notify');
const { BRAND, SITE_URL } = require('../utils/emailTemplate');

const {
  REMINDER_TZ, DAY_MS, localDate, daysRemaining,
} = require('../utils/dateUtils');

/**
 * How many days before expiry the twice-daily chase begins. Members at or below
 * this many days left — including those already overdue — are reminded every
 * slot until their membership end date moves.
 */
const REMINDER_WINDOW_DAYS = Number(process.env.REMINDER_WINDOW_DAYS || 4);

/**
 * How many days past expiry the automatic chase continues before it gives up.
 *
 * Bounded on purpose. Reminding someone twice a day forever after they have
 * clearly lapsed is how a gym gets marked as spam, and it buries the members
 * who are genuinely about to renew. After this many days the sweep goes quiet
 * and it becomes an admin decision — "Send reminder" on the Members page still
 * works at any age, with no limit.
 */
const REMINDER_GRACE_DAYS = Number(process.env.REMINDER_GRACE_DAYS || 3);

/**
 * Identifier for one reminder send, e.g. "2026-09-03-am".
 *
 * Storing this on the member is what makes the sweep idempotent *per slot*
 * rather than per lifetime: the morning run and the evening run are different
 * slots so both go out, but Vercel retrying the morning run does not.
 */
function slotKey(slot, at = new Date()) {
  return `${localDate(at)}-${slot === 'pm' ? 'pm' : 'am'}`;
}

/** Concurrency for the sweep — bounded so Meta API and SMTP aren't flooded. */
const SWEEP_CONCURRENCY = Number(process.env.REMINDER_CONCURRENCY || 5);

function contactNumber() {
  return adminWhatsAppNumber();
}

function renewUrl() {
  return `${process.env.FRONTEND_URL || SITE_URL}/plans`;
}

/**
 * Decide which reminder (if any) a member is due, based on days remaining and
 * which reminders have already been sent. Returns null when nothing is due.
 *
 * WhatsApp milestone schedule:
 *   - 2 days before expiry (daysLeft === 2)  -> 1 message (flag: reminderSentWA2days)
 *   - On expiry day (daysLeft === 0)         -> 1 message (flag: reminderSentWAExpiry)
 *   - 1 day after expiry (daysLeft === -1)   -> 1 message (flag: reminderSentWA1dayAfter)
 *   - Sent once per milestone; no automated WhatsApp messages on other days.
 *
 * Email schedule:
 *   - 7 days before expiry (daysLeft > 3 && daysLeft <= 7 && !member.reminderSent7days)
 *   - Final stretch (daysLeft <= REMINDER_WINDOW_DAYS && daysLeft >= -REMINDER_GRACE_DAYS && member.lastReminderSlot !== key)
 */
function planReminder(member, now, slot = 'am') {
  const daysLeft = daysRemaining(member.membershipEnd, now);
  if (daysLeft === null) return null;
  const on = () => new Date(member.membershipEnd).toLocaleDateString('en-IN');
  const key = slotKey(slot, now);

  // 1. Email check (preserved current logic)
  const email7DaysDue = daysLeft > 3 && daysLeft <= 7 && !member.reminderSent7days;
  const inFinalStretch = daysLeft <= REMINDER_WINDOW_DAYS && daysLeft >= -REMINDER_GRACE_DAYS;
  const emailSlotDue = inFinalStretch && member.lastReminderSlot !== key;
  const isEmailDue = email7DaysDue || emailSlotDue;

  // 2. WhatsApp check (strict 3 milestones: 2 days before, on expiry day, 1 day after)
  let isWADue = false;
  let waFlag = null;
  if (daysLeft === 2 && !member.reminderSentWA2days) {
    isWADue = true;
    waFlag = 'reminderSentWA2days';
  } else if (daysLeft === 0 && !member.reminderSentWAExpiry) {
    isWADue = true;
    waFlag = 'reminderSentWAExpiry';
  } else if (daysLeft === -1 && !member.reminderSentWA1dayAfter) {
    isWADue = true;
    waFlag = 'reminderSentWA1dayAfter';
  }

  // If neither channel is due this pass, skip
  if (!isEmailDue && !isWADue) return null;

  const channels = ['website'];
  if (isEmailDue) channels.push('email');
  if (isWADue) channels.push('whatsapp');

  const overdue = daysLeft < 0;
  const when = overdue
    ? `expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) > 1 ? 's' : ''} ago on ${on()}`
    : daysLeft === 0
      ? 'expires today'
      : `expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''} on ${on()}`;

  const title = overdue
    ? 'Your membership has expired'
    : daysLeft === 0 ? 'Your membership ends today' : 'Your membership ends soon';

  return {
    channels,
    daysLeft,
    slotKey: emailSlotDue ? key : null,
    flag: email7DaysDue ? 'reminderSent7days' : null,
    waFlag: isWADue ? waFlag : null,
    expire: overdue && member.membershipStatus !== 'expired',
    type: overdue ? 'membership-expired' : 'fee-reminder',
    title,
    message: `Dear ${member.name}, your ${BRAND} membership ${when}. Please renew to keep training. Contact us: ${contactNumber()}`,
    ctaText: 'Renew now',
    ctaUrl: renewUrl(),
  };
}

/**
 * Run the sweep. Resolves to { notified, failed, whatsapp, email, skipped }.
 * Never throws for a single member — one bad phone number must not abort the run.
 */
async function runFeeReminderSweep({ slot = 'am' } = {}) {
  const now = new Date();
  const members = await User.find({
    role: 'member',
    isActive: { $ne: false },          // a disabled account is not chased
    membershipStatus: { $in: ['active', 'expired', 'pending'] },
    membershipEnd: { $exists: true, $ne: null },
  });

  // Cache each member's plan so the payload fn and the flag update agree.
  const plans = new Map();

  const summary = await notifyMembers(
    members,
    member => {
      const plan = planReminder(member, now, slot);
      if (!plan) return null;
      plans.set(String(member._id), plan);
      return {
        type: plan.type,
        title: plan.title,
        message: plan.message,
        subject: `${plan.title} — ${BRAND}`,
        ctaText: plan.ctaText,
        ctaUrl: plan.ctaUrl,
        channels: plan.channels,
        customerName: member.name,
        daysRemaining: plan.daysLeft,
        isGymReminder: true,
      };
    },
    { concurrency: SWEEP_CONCURRENCY }
  );

  // Mark flags for members we notified using bulkWrite for minimal DB round-trips
  let flagFailures = 0;
  const updateOps = [];
  for (const member of members) {
    const plan = plans.get(String(member._id));
    if (!plan) continue;
    const $set = {};
    if (plan.slotKey) $set.lastReminderSlot = plan.slotKey;
    if (plan.flag) $set[plan.flag] = true;
    if (plan.waFlag) $set[plan.waFlag] = true;
    if (plan.expire) $set.membershipStatus = 'expired';

    if (Object.keys($set).length > 0) {
      updateOps.push({
        updateOne: {
          filter: { _id: member._id },
          update: { $set },
        },
      });
    }
  }

  if (updateOps.length > 0) {
    try {
      await User.bulkWrite(updateOps, { ordered: false });
    } catch (err) {
      flagFailures++;
      console.error(`❌ Could not bulk update reminder flags: ${err.message}`);
    }
  }

  // Data integrity pass: anything past its end date is marked expired in a single atomic update.
  // Otherwise a member who lapsed while the cron was down would sit as 'active' indefinitely.
  let expiredMarked = 0;
  try {
    const expireRes = await User.updateMany(
      {
        role: 'member',
        membershipStatus: { $ne: 'expired' },
        membershipEnd: { $lt: now },
      },
      { $set: { membershipStatus: 'expired' } }
    );
    expiredMarked = expireRes.modifiedCount || 0;
  } catch (err) {
    console.error(`❌ Could not bulk mark expired members: ${err.message}`);
  }

  return {
    slot,
    expiredMarked,
    notified: summary.sent,
    failed: summary.failed + flagFailures,
    skipped: summary.skipped,
    whatsapp: summary.whatsapp,
    email: summary.email,
  };
}

module.exports = {
  runFeeReminderSweep, planReminder, slotKey, daysRemaining,
  REMINDER_TZ, REMINDER_WINDOW_DAYS, REMINDER_GRACE_DAYS,
};
