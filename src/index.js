require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const { reportJwtSecretAtBoot } = require('./utils/jwtSecret');

reportJwtSecretAtBoot();

let connPromise = null;

function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);

  if (!process.env.MONGO_URI) {
    return Promise.reject(new Error('MONGO_URI environment variable is not set'));
  }

  if (!connPromise) {
    connPromise = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 4000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10,
      minPoolSize: 0,
    }).then(m => {
      console.log('✅ MongoDB connected');
      return m;
    }).catch(err => {
      connPromise = null;
      console.error('MongoDB connection error:', err.message);
      throw err;
    });
  }
  return connPromise;
}

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected — will reconnect on the next request');
  connPromise = null;
});

mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err.message);
});

connectDB().catch(() => {});

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
  const STATE = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const started = Date.now();
  let ok = true, error;
  try { await connectDB(); } catch (err) { ok = false; error = err.message; }
  res.set('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db: STATE[mongoose.connection.readyState] || 'unknown',
    mongoUriSet: Boolean(process.env.MONGO_URI),
    tookMs: Date.now() - started,
    error,
  });
});

// Notifications report on boot
try {
  const { channelHealth } = require('./services/notify');
  const h = channelHealth();
  console.log(`🔔 Notifications — website: on | whatsapp: ${h.whatsapp.configured ? `on (${h.whatsapp.from})` : `OFF (${h.whatsapp.reason})`} | email: ${h.email.configured ? `on (${h.email.from})` : `OFF (${h.email.reason})`}`);
} catch (e) {
  // Safe notification report
}

// Start cron jobs
if (process.env.VERCEL !== '1') {
  try {
    require('../jobs/feeReminder');
  } catch (e) {
    // Background cron start
  }
}

// Start Server locally if not in Vercel serverless
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 5000;
  const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

  server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`\n❌ Port ${PORT} is already in use.\n`);
    process.exit(1);
  });
}

module.exports = app;
