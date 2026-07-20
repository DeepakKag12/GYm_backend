const jwt = require('jsonwebtoken');
const User = require('../models/User');
const cache = require('../utils/cache');

// TTL = 5 minutes. Keeps DB lookups minimal across rapid successive requests.
const USER_CACHE_TTL = 300;

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'Not authorized, no token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const cacheKey = `user:${decoded.id}`;
    let user = cache.get(cacheKey);
    if (!user) {
      user = await User.findById(decoded.id).select('-password').lean();
      if (user) cache.set(cacheKey, user, USER_CACHE_TTL);
    }
    if (!user) return res.status(401).json({ message: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalid' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ message: 'Admin access only' });
};

const trainerOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'trainer')) return next();
  return res.status(403).json({ message: 'Trainer or Admin access only' });
};

module.exports = { protect, adminOnly, trainerOrAdmin };
