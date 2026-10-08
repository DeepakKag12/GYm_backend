const { runFeeReminderSweep } = require('../services/feeReminder');
const { sendDbError } = require('../utils/dbError');
const { asyncHandler } = require('../utils/asyncHandler');

// GET /api/cron/fee-reminder
const triggerFeeReminder = asyncHandler(async (req, res) => {
  try {
    const slot = req.query.slot === 'pm' ? 'pm' : 'am';
    const result = await runFeeReminderSweep({ slot });
    console.log(`✅ Cron fee-reminder [${result.slot}]: notified ${result.notified} (whatsapp ${result.whatsapp}, email ${result.email}), failed ${result.failed}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('❌ Cron fee-reminder error:', err.message);
    sendDbError(res, err);
  }
});

module.exports = {
  triggerFeeReminder,
};
