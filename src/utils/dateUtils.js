/**
 * Shared date arithmetic and formatting for memberships and reminders.
 *
 * Ensures a single source of truth across:
 *   - routes/members.js
 *   - routes/notifications.js
 *   - services/feeReminder.js
 *   - services/notify.js
 */

const REMINDER_TZ = process.env.REMINDER_TZ || 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_MONTHS = {
  monthly: 1,
  quarterly: 3,
  'half-yearly': 6,
  yearly: 12,
};

/**
 * Format a Date or date string to 'YYYY-MM-DD' in the gym's local timezone.
 * Defaults to 'Asia/Kolkata' (IST).
 */
function localDate(d = new Date(), tz = REMINDER_TZ) {
  if (!d) return null;
  const dateObj = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(d + 'T00:00:00')
    : new Date(d);
  if (Number.isNaN(dateObj.getTime())) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dateObj);
}

/**
 * Calculate the expiry date implied by a start date and a plan duration.
 * Clamps month-end rollovers (e.g., Jan 31 + 1 month -> Feb 28/29, Mar 31 + 1 month -> Apr 30).
 *
 * @param {Date|string} startDate
 * @param {string} plan ('monthly'|'quarterly'|'half-yearly'|'yearly')
 * @returns {Date|null}
 */
function calcExpiry(startDate, plan) {
  if (!startDate || !plan) return null;
  const d = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? new Date(startDate + 'T00:00:00')
    : new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;

  const months = PLAN_MONTHS[plan] || 1;
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);

  // If day rolled over to the next month due to shorter month, clamp to the last day of target month
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }

  return d;
}

/**
 * Whole calendar days from `now` until `membershipEnd`, evaluated in the gym's timezone.
 * Returns:
 *   > 0: Future (e.g. 2 = expires in 2 days)
 *   0:   Expires today
 *   < 0: Overdue (e.g. -1 = expired yesterday)
 *   null: Invalid or unset date
 *
 * @param {Date|string} membershipEnd
 * @param {Date|string} [now=new Date()]
 * @param {string} [tz=REMINDER_TZ]
 * @returns {number|null}
 */
function daysRemaining(membershipEnd, now = new Date(), tz = REMINDER_TZ) {
  if (!membershipEnd) return null;
  const end = new Date(membershipEnd);
  if (Number.isNaN(end.getTime())) return null;

  const nowDate = now ? new Date(now) : new Date();
  if (Number.isNaN(nowDate.getTime())) return null;

  const endStr = localDate(end, tz);
  const nowStr = localDate(nowDate, tz);
  if (!endStr || !nowStr) return null;

  const a = new Date(`${endStr}T00:00:00Z`).getTime();
  const b = new Date(`${nowStr}T00:00:00Z`).getTime();

  return Math.round((a - b) / DAY_MS);
}

module.exports = {
  REMINDER_TZ,
  DAY_MS,
  PLAN_MONTHS,
  localDate,
  calcExpiry,
  daysRemaining,
};
