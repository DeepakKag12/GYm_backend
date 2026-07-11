const sendWhatsApp = async (to, message) => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WHATSAPP_FROM;

  // Skip silently when Twilio credentials are not configured
  if (!sid || sid === 'your_twilio_sid' || !token || !from) {
    console.log(`⚠️  WhatsApp skipped (Twilio not configured) — would send to ${to}: ${message.slice(0, 60)}...`);
    return false;
  }

  try {
    const twilio = require('twilio');
    const client = twilio(sid, token);
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to.startsWith('+') ? to : '+' + to}`;
    await client.messages.create({ from, to: formattedTo, body: message });
    console.log(`✅ WhatsApp sent to ${to}`);
    return true;
  } catch (err) {
    console.error(`❌ WhatsApp error for ${to}:`, err.message);
    return false;
  }
};

module.exports = { sendWhatsApp };
