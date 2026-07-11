const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');
const { protect, adminOnly } = require('../middleware/auth');

// POST /api/enquiries - public: anyone can submit
router.post('/', async (req, res) => {
  try {
    const enquiry = await Enquiry.create(req.body);
    res.status(201).json({ message: 'Enquiry submitted successfully', enquiry });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/enquiries - admin only
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const enquiries = await Enquiry.find().sort({ createdAt: -1 });
    res.json(enquiries);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/enquiries/:id - admin update status
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(enquiry);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/enquiries/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Enquiry.findByIdAndDelete(req.params.id);
    res.json({ message: 'Enquiry deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
