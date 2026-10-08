const { ApiError } = require('../utils/ApiError');

/**
 * Central Error-Handling Middleware
 * Preserves exact existing error formats:
 * If an object has a message property or custom fields, outputs clean JSON.
 */
const errorHandler = (err, req, res, next) => {
  let error = err;

  const statusCode = error.statusCode || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  const message = error.message || 'Internal Server Error';

  return res.status(statusCode).json({
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  });
};

/**
 * 404 Route Not Found Middleware
 */
const notFound = (req, res, next) => {
  res.status(404).json({ message: `Route not found: ${req.originalUrl}` });
};

module.exports = { errorHandler, notFound };
