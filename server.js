require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const fileUpload = require('express-fileupload');
const path = require('path');

const app = express();

// ── Security Headers (Helmet) ──────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow Cloudinary images
  contentSecurityPolicy: false, // frontend handled separately by its own build
}));

// ── Compression ────────────────────────────────────────────────────────────────
// Gzip/Brotli all JSON + text responses; skip file uploads (already compressed).
app.use(compression({
  level: 6,
  filter: (req, res) => {
    // Don't compress multipart uploads
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) return false;
    return compression.filter(req, res);
  },
}));

// ── Rate Limiting ──────────────────────────────────────────────────────────────
// Auth routes: stricter limit to slow brute-force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again after 15 minutes.' },
});

// General API limiter — generous, just protects against scraping/abuse
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please slow down.' },
});

// ── Response-time header ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
  });
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
// credentials:true is incompatible with origin:'*' (CORS spec §3.2).
// Use a whitelist instead; if you genuinely need a fully public API drop
// credentials:true and keep origin:'*'.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow server-to-server requests (no origin) and listed origins
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Make sure preflight OPTIONS is handled for every route
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// On Vercel serverless use in-memory buffers (no /tmp/ write); locally use temp files
app.use(fileUpload({
  useTempFiles: process.env.VERCEL !== '1',
  tempFileDir: '/tmp/',
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  abortOnLimit: false,
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check / root route
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'FitnessByAjeet API is running' });
});

// MongoDB connection — connect once, reuse connection across serverless invocations
let isConnected = false;
let dbError = null;

async function connectDB() {
  if (isConnected) return;
  if (!process.env.MONGO_URI) {
    dbError = new Error('MONGO_URI environment variable is not set');
    throw dbError;
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  isConnected = true;
  dbError = null;
  console.log('✅ MongoDB connected');
}

connectDB().catch(err => {
  dbError = err;
  console.error('MongoDB connection error:', err.message);
});

// Middleware: fail fast if DB is not connected instead of waiting 10 s to time out
app.use('/api', (req, res, next) => {
  if (dbError) {
    return res.status(503).json({ message: 'Database unavailable. Check MONGO_URI env var on Vercel.' });
  }
  next();
});

// ── Apply rate limiters before routes ─────────────────────────────────────────
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/members',      require('./routes/members'));
app.use('/api/exercises',    require('./routes/exercises'));
app.use('/api/diet',         require('./routes/diet'));
app.use('/api/store',        require('./routes/store'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/transformations', require('./routes/transformations'));
app.use('/api/enquiries',    require('./routes/enquiries'));
app.use('/api/notifications',require('./routes/notifications'));
app.use('/api/trainers',     require('./routes/trainers'));
app.use('/api/analytics',    require('./routes/analytics'));
app.use('/api/progress',     require('./routes/progress'));
app.use('/api/plans',        require('./routes/plans'));
app.use('/api/splits',       require('./routes/splits'));
app.use('/api/cron',         require('./routes/cron'));

// ── Cache stats health endpoint ────────────────────────────────────────────────
app.get('/api/_cache/stats', (req, res) => {
  const cache = require('./utils/cache');
  res.json({ entries: cache.size() });
});

// Return JSON 404 for any unmatched /api/* routes (prevents HTML 404 confusing the frontend)
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: `API route not found: ${req.originalUrl}` });
});

// Global error handler — must have 4 params so Express treats it as error middleware.
// Ensures CORS headers are already set (by the cors() middleware above) before we reach here,
// so the browser always receives Access-Control-Allow-Origin even on 500 responses.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: err.message || 'Internal server error' });
});

// Start cron jobs for fee reminders — skip in serverless (Vercel) environment
if (process.env.VERCEL !== '1') {
  require('./jobs/feeReminder');
}

// Export for Vercel serverless; also listen locally
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
