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

// PUT /api/trainers/:id - admin edits trainer
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const update = { name, email, phone };
    if (password) {
      const bcrypt = require('bcryptjs');
      update.password = await bcrypt.hash(password, 10);
    }
    const trainer = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' });
    res.json(trainer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/trainers/:id - admin deletes trainer
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Trainer deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
