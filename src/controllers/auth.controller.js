const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User.model');
const cache = require('../utils/cache');
const { sendDbError } = require('../utils/dbError');
const { asyncHandler } = require('../utils/asyncHandler');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
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
const login = asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const identifier = String(email || '').trim();
    const digitsOnly = identifier.replace(/\D/g, '');
    let user;
    if (digitsOnly.length === 10) {
      user = await User.findOne({
        $or: [
          { phone: digitsOnly },
          { phone: `+91${digitsOnly}` },
          { phone: `91${digitsOnly}` },
          { email: identifier.toLowerCase() },
        ],
      });
    } else {
      user = await User.findOne({ email: identifier.toLowerCase() });
    }
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
const getMe = asyncHandler(async (req, res) => {
  res.json(req.user);
});

// PUT /api/auth/update-profile
const updateProfile = asyncHandler(async (req, res) => {
  try {
    const { name, phone, whatsapp, address, dob, gender } = req.body;
    const updates = {};
    if (name     !== undefined) updates.name     = name.trim();
    if (phone    !== undefined) updates.phone    = phone;
    if (whatsapp !== undefined) updates.whatsapp = whatsapp;
    if (address  !== undefined) updates.address  = address;
    if (dob      !== undefined) updates.dob      = dob || null;
    if (gender   !== undefined) updates.gender   = gender;

    const updated = await User.findByIdAndUpdate(
      req.user._id, updates, { new: true }
    ).select('-password');
    cache.del(`user:${req.user._id}`);
    res.json({ message: 'Profile updated successfully', user: updated });
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/auth/update-credentials
const updateCredentials = asyncHandler(async (req, res) => {
  try {
    const { currentPassword, newEmail, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required' });
    }

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ message: 'Current password is incorrect' });

    if (newEmail) {
      const normalizedEmail = String(newEmail).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ message: 'Invalid email address format' });
      }
      if (normalizedEmail !== user.email) {
        const exists = await User.findOne({ email: normalizedEmail });
        if (exists) return res.status(400).json({ message: 'Email already in use' });
        user.email = normalizedEmail;
      }
    }

    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();
    cache.del(`user:${user._id}`);
    const updated = await User.findById(user._id).select('-password');
    res.json({ message: 'Credentials updated successfully', user: updated });
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  updateCredentials,
};
