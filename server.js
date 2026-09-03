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
// Must be stamped in writeHead, not on 'finish': by the time 'finish' fires the
// headers are already on the wire, so setHeader() threw ERR_HTTP_HEADERS_SENT
// from an event handler — an uncaught exception that killed the process on
// every single request.
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

// ── CORS ──────────────────────────────────────────────────────────────────────
// credentials:true is incompatible with origin:'*' (CORS spec §3.2).
// Use a whitelist instead; if you genuinely need a fully public API drop
// credentials:true and keep origin:'*'.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Local development origins are always allowed off-production. Without this the
// only way to run the frontend against this API was to add localhost to the
// deployed ALLOWED_ORIGINS, which meant production trusted a developer laptop.
const isLocalOrigin = origin =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const isProduction = process.env.NODE_ENV === 'production';

function isOriginAllowed(origin) {
  if (!origin) return true;                       // curl, server-to-server, health checks
  if (allowedOrigins.includes(origin)) return true;
  if (allowedOrigins.length === 0) return true;   // unconfigured: don't lock everyone out
  if (!isProduction && isLocalOrigin(origin)) return true;
  return false;
}

const corsOptions = {
  origin: function (origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);

    // Deliberately NOT `callback(new Error(...))`. Passing an Error here makes
    // Express answer the preflight with a 500, which is what made every login
    // from an unlisted origin look like a dead backend instead of a blocked
    // origin. Returning false simply omits the CORS headers: the browser
    // refuses the request with a real CORS message, and the server stays 2xx.
    console.warn(`[CORS] blocked origin: ${origin}`);
    return callback(null, false);
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

/**
 * MongoDB connection, shaped for serverless.
 *
 * A lambda is frozen between requests, not torn down, so the connection is
 * cached on the module and reused by every later invocation on that instance.
 *
 * Three things this has to get right, each of which was previously wrong and
 * each of which looked like "the database is not connecting" in production:
 *
 *   1. Requests must WAIT for the connection. connectDB() used to be fired at
 *      module load without being awaited, and the guard below only checked
 *      whether an error had been recorded. On a cold start the first request
 *      sailed past a still-connecting mongoose, and the query sat in Mongoose's
 *      buffer until it gave up — "buffering timed out after 10000ms".
 *
 *   2. A failure must be retryable. The first failed attempt used to set a
 *      module-level dbError that nothing ever cleared, and connectDB was never
 *      called again. One transient blip on a cold start — an Atlas failover, a
 *      slow DNS lookup — and that instance answered 503 to every request for
 *      the rest of its life. Only a redeploy brought it back. The promise is
 *      now dropped on failure, so the very next request tries again.
 *
 *   3. Concurrent cold starts must not each dial out. Caching the promise
 *      rather than a boolean means ten simultaneous requests share one connect.
 */
let connPromise = null;

function connectDB() {
  // 1 = connected. Anything else and we (re)establish, which also covers an
  // instance whose connection dropped while it was frozen.
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);

  if (!process.env.MONGO_URI) {
    return Promise.reject(new Error('MONGO_URI environment variable is not set'));
  }

  if (!connPromise) {
    connPromise = mongoose.connect(process.env.MONGO_URI, {
      // Comfortably inside the platform's function timeout, so a genuine
      // outage returns a clean 503 rather than a gateway timeout.
      serverSelectionTimeoutMS: 8000,
      // Each serverless instance keeps its own pool; the driver's default of
      // 100 multiplied by every warm lambda is how an Atlas cluster runs out
      // of connections. A handful per instance is plenty for this traffic.
      maxPoolSize: 10,
      minPoolSize: 0,
    }).then(m => {
      console.log('✅ MongoDB connected');
      return m;
    }).catch(err => {
      // Drop the cached promise so the next request retries instead of
      // inheriting this failure forever.
      connPromise = null;
      console.error('MongoDB connection error:', err.message);
      throw err;
    });
  }
  return connPromise;
}

// If the connection drops, forget the cached promise so the next request
// reconnects rather than querying a dead socket.
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected — will reconnect on the next request');
  connPromise = null;
});
mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err.message);
});

// Warm the connection at module load so the first real request is not the one
// paying for it. Failure here is not fatal: the guard below retries.
connectDB().catch(() => {});

// Every /api request waits for a live connection before touching a model.
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(503).json({
      message: 'Database unavailable. Please try again in a moment.',
      detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
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
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/splits',       require('./routes/splits'));
app.use('/api/cron',         require('./routes/cron'));

// ── Cache stats health endpoint ────────────────────────────────────────────────
// Hit rate is the number worth watching: if it sits low, either the TTLs are
// too short or this instance is being recycled before the cache warms up.
app.get('/api/_cache/stats', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(require('./utils/cache').getStats());
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

// ── Notification channel report ───────────────────────────────────────────────
// Print on boot which delivery channels are live, so a missing Twilio/SMTP env
// var shows up here instead of as a silently undelivered reminder at 09:00.
{
  const { channelHealth } = require('./services/notify');
  const h = channelHealth();
  console.log(`🔔 Notifications — website: on | whatsapp: ${h.whatsapp.configured ? `on (${h.whatsapp.from})` : `OFF (${h.whatsapp.reason})`} | email: ${h.email.configured ? `on (${h.email.from})` : `OFF (${h.email.reason})`}`);
}

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
