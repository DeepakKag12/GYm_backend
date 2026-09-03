const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
// role is intentionally ignored — public registration always creates a member
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'Name, email, phone and password are all required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const normalisedEmail = String(email).trim().toLowerCase();
    const exists = await User.findOne({ email: normalisedEmail });
    if (exists) return res.status(400).json({ message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name, email: normalisedEmail, phone, password: hashed, role: 'member',
    });
    res.status(201).json({ token: signToken(user._id), user: { ...user._doc, password: undefined } });
  } catch (err) {
    sendDbError(res, err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    // The schema lowercases email on write, so a stored address is always
    // lowercase. Normalising the lookup too means "Ajeet@Gym.in" and a stray
    // trailing space from a phone keyboard still find the account.
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    // 401, not 400: the request was fine, the credentials were refused. The
    // message stays identical either way so it cannot be used to discover
    // which email addresses exist.
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.isActive === false) {
      return res.status(403).json({ message: 'Account deactivated. Contact the gym.' });
    }
    res.json({ token: signToken(user._id), user: { ...user._doc, password: undefined } });
  } catch (err) {
    sendDbError(res, err);
  }
});

// GET /api/auth/me
const { protect } = require('../middleware/auth');
router.get('/me', protect, (req, res) => {
  res.json(req.user);
});

// PUT /api/auth/update-profile — any authenticated user updates their own profile fields
router.put('/update-profile', protect, async (req, res) => {
  try {
    const { name, phone, whatsapp, address, dob, gender } = req.body;
    const updates = {};
    if (name    !== undefined) updates.name    = name.trim();
    if (phone   !== undefined) updates.phone   = phone;
    if (whatsapp!== undefined) updates.whatsapp= whatsapp;
    if (address !== undefined) updates.address = address;
    if (dob     !== undefined) updates.dob     = dob || null;
    if (gender  !== undefined) updates.gender  = gender;

    const updated = await User.findByIdAndUpdate(
      req.user._id, updates, { new: true }
    ).select('-password');
    // Bust the cached user so the protect middleware picks up fresh data
    cache.del(`user:${req.user._id}`);
    res.json({ message: 'Profile updated successfully', user: updated });
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/auth/update-credentials
router.put('/update-credentials', protect, async (req, res) => {
  try {
    const { currentPassword, newEmail, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required' });
    }

    // Verify current password
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ message: 'Current password is incorrect' });

    if (newEmail && newEmail !== user.email) {
      const exists = await User.findOne({ email: newEmail });
      if (exists) return res.status(400).json({ message: 'Email already in use' });
      user.email = newEmail;
    }

    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    // Bust the cached user or `protect` serves the old email for up to 5 minutes
    cache.del(`user:${user._id}`);
    const updated = await User.findById(user._id).select('-password');
    res.json({ message: 'Credentials updated successfully', user: updated });
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = router;
