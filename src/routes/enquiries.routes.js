const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middlewares/auth.middleware');
const {
  createEnquiry,
  getAllEnquiries,
  updateEnquiry,
  replyToEnquiry,
  deleteEnquiry,
} = require('../controllers/enquiries.controller');

// Public lead submission
router.post('/', createEnquiry);

// Admin enquiry management
router.get('/', protect, adminOnly, getAllEnquiries);
router.put('/:id', protect, adminOnly, updateEnquiry);
router.post('/:id/reply', protect, adminOnly, replyToEnquiry);
router.delete('/:id', protect, adminOnly, deleteEnquiry);

module.exports = router;
