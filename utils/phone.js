/**
 * One canonical form for a phone number.
 *
 * Deliberately dependency-free so both the User model and the duplicate check
 * can use it. If they normalised differently, the same number could be stored
 * one way and looked up another, and the duplicate guard would miss it — which
 * is exactly what happened with "+91 98765 43210" versus "9876543210".
 *
 * The canonical form is the local 10-digit number: that is how numbers are
 * displayed, dialled and searched throughout this app, and how they are already
 * stored for every existing member.
 */

/**
 * @param {string} raw Anything a person might type
 * @returns {string} digits only, with an Indian country code or trunk 0 removed
 */
function canonicalPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';

  // +91 98765 43210 / 0091… -> 9876543210
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  if (digits.length === 14 && digits.startsWith('0091')) return digits.slice(4);
  // 09876543210 -> 9876543210
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);

  // Anything else (a genuine foreign number, a short code) is left alone rather
  // than being mangled into something that dials somewhere different.
  return digits;
}

module.exports = { canonicalPhone };
