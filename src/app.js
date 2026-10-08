const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const fileUpload = require('express-fileupload');
const path = require('path');
const { connectDB } = require('./config/db');
const { enforceJwtSecret } = require('./utils/jwtSecret');
const apiRoutes = require('./routes/index');
const { errorHandler } = require('./middlewares/error.middleware');

const app = express();

app.set('trust proxy', 1);

// Security Headers (Helmet)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow Cloudinary images
  contentSecurityPolicy: false,
}));

// Compression
app.use(compression({
  level: 6,
  filter: (req, res) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) return false;
    return compression.filter(req, res);
  },
}));

// Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again after 15 minutes.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please slow down.' },
});

// Response-time header
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    if (!res.headersSent) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      this.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
    }
    return writeHead.apply(this, args);
  };
  next();
});

// CORS Whitelist Configuration
const KNOWN_FRONTEND_ORIGINS = [
  'https://gym-web-ten-puce.vercel.app',
  'https://gym-web.vercel.app',
];

const allowedOrigins = [...new Set([
  ...KNOWN_FRONTEND_ORIGINS,
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ...(process.env.ALLOWED_ORIGINS || '').split(','),
].map(s => s.trim().replace(/\/+$/, '')).filter(Boolean))];

const isLocalOrigin = origin => /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)(?::\d+)?$/i.test(origin);
const VERCEL_FRONTEND_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)*(?:gym(?:-[a-z0-9-]+)*|fitnation|fitnessbyajeet)(?:-[a-z0-9-]+)?(?:\.vercel\.app|-deepak-kags-projects\.vercel\.app)$/i;

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (allowedOrigins.length === 0) return true;
  if (/\.vercel\.app$/i.test(origin)) return true;
  if (VERCEL_FRONTEND_PATTERN.test(origin)) return true;
  if (isLocalOrigin(origin)) return true;
  return false;
}

const corsOptions = {
  origin: function (origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    console.warn(`[CORS] blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 204,
  maxAge: 600,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(fileUpload({
  useTempFiles: process.env.VERCEL !== '1',
  tempFileDir: '/tmp/',
  limits: { fileSize: 100 * 1024 * 1024 },
  abortOnLimit: false,
}));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Root route
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'FitnessByAjeet API is running' });
});

// Cache stats endpoint
app.get('/api/_cache/stats', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(require('./utils/cache').getStats());
});

// Health check endpoint
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

// Every /api request waits for a live connection before touching a model.
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (first) {
    try {
      await connectDB();
      return next();
    } catch (err) {
      res.status(503).json({
        message: 'Database unavailable. Please try again in a moment.',
        detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
      });
    }
  }
});

// Rate limit guards on routes
app.use('/api/auth', enforceJwtSecret);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api', apiLimiter);

// Mount All Aggregated API Routes
app.use('/api', apiRoutes);

// Catch unmatched /api/* routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: `API route not found: ${req.originalUrl}` });
});

// Central Error Handler
app.use(errorHandler);

module.exports = app;
