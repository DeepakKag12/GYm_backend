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
const User = require('../models/User');
const { notifyMembers, adminWhatsAppNumber } = require('./notify');
const { BRAND, SITE_URL } = require('../utils/emailTemplate');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The gym's local timezone. Everything a member sees — "expires in 2 days",
 * "today" — has to be reckoned here, not in UTC, or an evening reminder in
 * India lands on the wrong calendar day.
 */
const REMINDER_TZ = process.env.REMINDER_TZ || 'Asia/Kolkata';

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

/** Local calendar date as YYYY-MM-DD. */
function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

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

/** Whole days from now until the membership ends, in the gym's timezone. */
function daysRemaining(membershipEnd, now) {
  const end = new Date(membershipEnd);
  if (Number.isNaN(end.getTime())) return null;
  // Compare date-to-date so "expires today" is 0 rather than a rounded fraction.
  const a = new Date(`${localDate(end)}T00:00:00Z`).getTime();
  const b = new Date(`${localDate(now)}T00:00:00Z`).getTime();
  return Math.round((a - b) / DAY_MS);
}

/** Concurrency for the sweep — keeps Twilio well under its per-second limit. */
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
 */
function planReminder(member, now, slot = 'am') {
  const daysLeft = daysRemaining(member.membershipEnd, now);
  if (daysLeft === null) return null;
  const on = () => new Date(member.membershipEnd).toLocaleDateString('en-IN');
  const key = slotKey(slot, now);

  // The final stretch repeats twice a day, from REMINDER_WINDOW_DAYS before
  // expiry until REMINDER_GRACE_DAYS after it. Renewing pushes membershipEnd
  // forward and drops the member out of the window, so paying stops the
  // messages; so does running past the grace period, after which chasing is a
  // manual decision.
  if (daysLeft <= REMINDER_WINDOW_DAYS && daysLeft >= -REMINDER_GRACE_DAYS) {
    if (member.lastReminderSlot === key) return null;   // already sent this slot

    const overdue = daysLeft < 0;
    const when = overdue
      ? `expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) > 1 ? 's' : ''} ago on ${on()}`
      : daysLeft === 0
        ? 'expires today'
        : `expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''} on ${on()}`;

    return {
      slotKey: key,
      // Flip the stored status the first time we see it lapsed, but keep
      // reminding either way.
      expire: overdue && member.membershipStatus !== 'expired',
      type: overdue ? 'membership-expired' : 'fee-reminder',
      title: overdue
        ? 'Your membership has expired'
        : daysLeft === 0 ? 'Your membership ends today' : 'Your membership ends soon',
      message: `Dear ${member.name}, your ${BRAND} membership ${when}. Please renew to keep training. Contact us: ${contactNumber()}`,
      ctaText: 'Renew now',
      ctaUrl: renewUrl(),
    };
  }

  if (daysLeft > 3 && daysLeft <= 7 && !member.reminderSent7days) {
    return {
      flag: 'reminderSent7days',
      type: 'fee-reminder',
      title: 'Membership renewal reminder',
      message: `Dear ${member.name}, your ${BRAND} membership expires in ${daysLeft} days on ${on()}. Plan your renewal today!`,
      ctaText: 'View plans',
      ctaUrl: renewUrl(),
    };
  }
  return null;
}

/**
 * Run the sweep. Resolves to { notified, failed, whatsapp, email, skipped }.
 * Never throws for a single member — one bad phone number must not abort the run.
 *
 * The per-member reminder flag is only set once the notification has been
 * dispatched, and the flag write is what makes the sweep idempotent: re-running
 * it the same day re-notifies nobody.
 */
async function runFeeReminderSweep({ slot = 'am' } = {}) {
  const now = new Date();
  // 'expired' is included on purpose: those are exactly the people who still
  // owe a renewal. Filtering to 'active' meant the first sweep marked someone
  // expired and the next sweep could no longer see them.
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
      };
    },
    { concurrency: SWEEP_CONCURRENCY }
  );

  // Mark flags for members we notified. The expired status is handled
  // separately below, because it must be applied to lapsed members whether or
  // not they were due a message this slot.
  let flagFailures = 0;
  for (const member of members) {
    const plan = plans.get(String(member._id));
    if (!plan) continue;
    try {
      // Written only after the notification was dispatched, so a crash mid-send
      // means the member is retried rather than silently skipped.
      if (plan.slotKey) member.lastReminderSlot = plan.slotKey;
      if (plan.flag) member[plan.flag] = true;
      if (plan.expire) member.membershipStatus = 'expired';
      await member.save();
    } catch (err) {
      flagFailures++;
      console.error(`❌ Could not update reminder flag for ${member._id}: ${err.message}`);
    }
  }

  // Data integrity pass: anything past its end date is marked expired, even if
  // it aged out of the reminder window and got no message. Otherwise a member
  // who lapsed while the cron was down would sit as 'active' indefinitely.
  let expiredMarked = 0;
  for (const member of members) {
    const left = daysRemaining(member.membershipEnd, now);
    if (left === null || left >= 0) continue;
    if (member.membershipStatus === 'expired') continue;
    try {
      member.membershipStatus = 'expired';
      await member.save();
      expiredMarked++;
    } catch (err) {
      console.error(`❌ Could not mark ${member._id} expired: ${err.message}`);
    }
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
