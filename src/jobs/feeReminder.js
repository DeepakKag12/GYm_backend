/**
 * Local-development scheduler for the fee-reminder sweep.
 * On Vercel this job does NOT run (server.js skips it); Vercel Cron calls
 * GET /api/cron/fee-reminder instead. Both paths share services/feeReminder.js.
 */
const cron = require('node-cron');
const { runFeeReminderSweep } = require('../services/feeReminder');

cron.schedule('0 9 * * *', async () => {
  console.log('⏰ Running fee reminder cron job...');
  try {
    const r = await runFeeReminderSweep();
    console.log(`⏰ Fee reminder complete — notified ${r.notified} (whatsapp ${r.whatsapp}, email ${r.email}), failed ${r.failed}`);
  } catch (err) {
    console.error('❌ Fee reminder cron error:', err.message);
  }
});

console.log('🔔 Fee reminder cron job scheduled');
