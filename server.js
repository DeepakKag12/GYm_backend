/**
 * Root Server Entry Point
 * Delegates directly to src/index.js for clean modular architecture.
 * Exports Express app for Vercel serverless deployment compatibility.
 */
module.exports = require('./src/index');
