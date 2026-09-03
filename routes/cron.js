/**
 * GET /api/cron/fee-reminder
 *
 * Called by Vercel Cron (schedule in vercel.json) daily at 09:00 UTC.
 * Vercel sends the secret as `Authorization: Bearer <CRON_SECRET>`.
 *
 * The sweep itself lives in services/feeReminder.js and is shared with the
 * local node-cron job in jobs/feeReminder.js.
 */
const express = require('express');
const router = express.Router();
const { runFeeReminderSweep } = require('../services/feeReminder');
const { sendDbError } = require('../utils/dbError');

/**
 * Previously: `if (secret) { ...check... }` — so with CRON_SECRET unset the
 * endpoint was wide open and anyone could trigger a full WhatsApp send at will.
 * Now a missing secret fails closed.
 */
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({
      message: 'CRON_SECRET is not configured on the server; cron endpoint disabled.',
    });
  }
  if ((req.headers.authorization || '') !== `Bearer ${secret}`) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

router.get('/fee-reminder', requireCronSecret, async (req, res) => {
  try {
    // Two scheduled runs a day (see vercel.json). The slot keeps them apart so
    // both are delivered, while a retry of either one is not.
    const slot = req.query.slot === 'pm' ? 'pm' : 'am';
    const result = await runFeeReminderSweep({ slot });
    console.log(`✅ Cron fee-reminder [${result.slot}]: notified ${result.notified} (whatsapp ${result.whatsapp}, email ${result.email}), failed ${result.failed}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('❌ Cron fee-reminder error:', err.message);
    sendDbError(res, err);
  }
});

module.exports = router;
