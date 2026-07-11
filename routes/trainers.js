const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/trainers - public trainer list
router.get('/', async (req, res) => {
  try {
    const trainers = await User.find({ role: 'trainer', isActive: true }).select('-password');
    res.json(trainers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/trainers - admin adds trainer
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { name, email, phone, password, specialization, bio } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already registered' });
    const hashed = await bcrypt.hash(password || phone, 10);
    const trainer = await User.create({ name, email, phone, password: hashed, role: 'trainer', address: bio });
    res.status(201).json(trainer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
