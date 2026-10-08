const express = require('express');
const router = express.Router();
const { triggerFeeReminder } = require('../controllers/cron.controller');

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

router.get('/fee-reminder', requireCronSecret, triggerFeeReminder);

module.exports = router;
