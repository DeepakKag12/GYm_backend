const express = require('express');
const router = express.Router();
const {
  getPayments,
  getDuePayments,
  streamMemberStatement,
  streamPaymentReceipt,
  generateMemberStatement,
  sendMemberStatementWhatsApp,
  getPaymentSummary,
  recordPayment,
  addDuePayment,
  updateDuePayment,
  settleDuePayments,
  backfillPayments,
} = require('../controllers/payments.controller');
const { protect, adminOnly } = require('../middlewares/auth.middleware');

router.get('/', protect, adminOnly, getPayments);
router.get('/due', protect, adminOnly, getDuePayments);
router.get('/:memberId/statement', protect, adminOnly, streamMemberStatement);
router.get('/:paymentId/receipt', protect, adminOnly, streamPaymentReceipt);
router.get('/receipt/:paymentId', protect, adminOnly, streamPaymentReceipt);
router.post('/:memberId/statement', protect, adminOnly, generateMemberStatement);
router.post('/:memberId/statement/whatsapp', protect, adminOnly, sendMemberStatementWhatsApp);
router.get('/summary', protect, adminOnly, getPaymentSummary);
router.post('/', protect, adminOnly, recordPayment);
router.post('/due', protect, adminOnly, addDuePayment);
router.patch('/due/:memberId', protect, adminOnly, updateDuePayment);
router.put('/due/:memberId', protect, adminOnly, updateDuePayment);
router.post('/due/settle', protect, adminOnly, settleDuePayments);
router.post('/backfill', protect, adminOnly, backfillPayments);

module.exports = router;
