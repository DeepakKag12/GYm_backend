/**
 * Format a phone number to E.164 (+countrycode format).
 * Handles:
 *  - Already has 'whatsapp:' prefix → return as-is
 *  - Already starts with '+' → use as-is
 *  - Indian 10-digit number (starts with 6/7/8/9, no country code) → prepend +91
 *  - Number with leading 0 (e.g. 0XXXXXXXXXX) → strip the 0 and prepend +91
 *  - Anything else → prepend '+' and hope for the best
 */
function formatWhatsAppNumber(to) {
  if (to.startsWith('whatsapp:')) return to;
  // Strip any spaces, dashes, dots
  const cleaned = to.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return `whatsapp:${cleaned}`;
  // Indian mobile: 10 digits starting with 6/7/8/9
  if (/^[6-9]\d{9}$/.test(cleaned)) return `whatsapp:+91${cleaned}`;
  // Indian number with leading 0 (e.g. 09876543210 → +919876543210)
  if (/^0[6-9]\d{9}$/.test(cleaned)) return `whatsapp:+91${cleaned.slice(1)}`;
  // Already has country code digits but no +
  return `whatsapp:+${cleaned}`;
}

const sendWhatsApp = async (to, message) => {
  if (!to) {
    console.log('⚠️  WhatsApp skipped — no phone number provided');
    return false;
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM;

  // Detailed logging so you can diagnose config issues from server logs
  if (!sid || sid === 'your_twilio_sid' || sid === 'your_twilio_auth') {
    console.warn('⚠️  WhatsApp skipped — TWILIO_ACCOUNT_SID is missing or still a placeholder');
    return false;
  }
  if (!token || token === 'your_twilio_auth') {
    console.warn('⚠️  WhatsApp skipped — TWILIO_AUTH_TOKEN is missing or still a placeholder');
    return false;
  }
  if (!from) {
    console.warn('⚠️  WhatsApp skipped — TWILIO_WHATSAPP_FROM is not set (e.g. whatsapp:+14155238886)');
    return false;
  }

  const formattedTo = formatWhatsAppNumber(to);

  try {
    const twilio = require('twilio');
    const client = twilio(sid, token);
    await client.messages.create({ from, to: formattedTo, body: message });
    console.log(`✅ WhatsApp sent to ${formattedTo}`);
    return true;
  } catch (err) {
    console.error(`❌ WhatsApp error for ${formattedTo}:`, err.message);
    return false;
  }
};

module.exports = { sendWhatsApp };
