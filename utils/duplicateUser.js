const User = require('../models/User');
const { canonicalPhone } = require('./phone');

/**
 * One place that answers "does this person already exist?".
 *
 * The create endpoints used to check only the email, so the same member could
 * be added twice with a second address — the gym then chased two records for
 * one person, and reminders went out twice.
 *
 * A person is identified by either their email or their phone number. Matching
 * on name is deliberately not done: two members really can be called the same
 * thing, which is exactly why the Users list shows the phone under the name.
 */

/** Shared with the User model, so lookup and storage always agree. */
const normalisePhone = canonicalPhone;

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Find an existing account that clashes with these details.
 *
 * @param {object}  fields
 * @param {string} [fields.email]
 * @param {string} [fields.phone]
 * @param {string} [fields.excludeId]  Ignore this account — used when editing,
 *                                     so a member never clashes with themselves.
 * @returns {Promise<{field:'email'|'phone', user:object, message:string}|null>}
 */
async function findDuplicate({ email, phone, excludeId } = {}) {
  const or = [];
  const cleanEmail = normaliseEmail(email);
  const cleanPhone = normalisePhone(phone);

  if (cleanEmail) or.push({ email: cleanEmail });
  if (cleanPhone) or.push({ phone: cleanPhone });
  if (or.length === 0) return null;

  const query = { $or: or };
  if (excludeId) query._id = { $ne: excludeId };

  // Only the fields needed to explain the clash — never the password hash.
  const found = await User.findOne(query).select('name email phone role').lean();
  if (!found) return null;

  // Report the field that actually matched, so the UI can mark the right input.
  const field = cleanEmail && found.email === cleanEmail ? 'email' : 'phone';
  const label = field === 'email' ? 'email address' : 'mobile number';

  return {
    field,
    user: found,
    message: `${found.name} already uses this ${label}. Search for them instead of adding a second account.`,
  };
}

module.exports = { findDuplicate, normalisePhone, normaliseEmail };
