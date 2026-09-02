#!/usr/bin/env node
/**
 * Send a real test notification over WhatsApp + email, without touching the DB.
 *
 *   node scripts/testNotification.js +919876543210 you@example.com
 *   npm run test:notify -- +919876543210 you@example.com
 *
 * Use this after setting the Twilio / SMTP env vars: it prints exactly which
 * channel worked, and for a failure the provider's error code and the fix.
 */
require('dotenv').config();
const { channelHealth, notifyMember } = require('../services/notify');
const { verifyTwilio } = require('../utils/whatsapp');
const { verifyTransport } = require('../utils/email');

(async () => {
  const [phone, email] = process.argv.slice(2);
  const health = channelHealth();

  console.log('\n── Channel configuration ──');
  for (const [name, c] of Object.entries(health)) {
    if (typeof c !== 'object') continue;
    console.log(`  ${name.padEnd(9)} ${c.configured ? '✅ ready' : '❌ ' + c.reason}${c.from ? `  (from: ${c.from})` : ''}`);
    if (c.warning) console.log(`             ⚠️  ${c.warning}`);
  }

  // Credential check — logs in to Twilio and to the SMTP server, but sends nothing.
  console.log('\n── Credential check (no messages sent) ──');
  const [wa, em] = await Promise.all([verifyTwilio(), verifyTransport()]);
  console.log(`  whatsapp  ${wa.ok ? `✅ authenticated as "${wa.account}" (${wa.accountStatus}, via ${wa.auth})` : `❌ ${wa.reason}`}`);
  console.log(`  email     ${em.ok ? `✅ SMTP login accepted (${em.transport})` : `❌ ${em.reason}`}`);

  if (!phone && !email) {
    console.log('\nUsage: node scripts/testNotification.js <phone> <email>\n');
    process.exit(0);
  }

  const channels = [...(phone ? ['whatsapp'] : []), ...(email ? ['email'] : [])];
  console.log(`\n── Sending test over: ${channels.join(' + ')} ──`);

  const { results } = await notifyMember(
    { _id: 'cli-test', name: 'Test', phone, whatsapp: phone, email },
    {
      type: 'general',
      title: 'Test notification',
      message: `Test from your gym backend at ${new Date().toLocaleString('en-IN')}.\n\nIf this reached you, the channel is live.`,
      ctaText: 'Open the app',
      ctaUrl: process.env.FRONTEND_URL || 'https://gym-web-ten-puce.vercel.app',
    },
    { channels, persist: false }   // persist:false → no DB connection needed
  );

  console.log('\n── Result ──');
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every(r => r.ok) ? 0 : 1);
})();
