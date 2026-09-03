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


/**
 * Behind Vercel (and any proxy) the TCP peer is the proxy, so req.ip is the
 * proxy's address for every visitor. The rate limiters key on req.ip, which
 * meant the whole gym shared ONE bucket: 200 requests a minute between every
 * member on every phone, and thirty failed logins from anyone locked the
 * login page for everyone. Trusting the first proxy hop makes req.ip the real
 * client from X-Forwarded-For, which Vercel sets and strips from the client.
 */
app.set('trust proxy', 1);

const { enforceJwtSecret, reportJwtSecretAtBoot } = require('./utils/jwtSecret');
reportJwtSecretAtBoot();
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
/**
 * Where the site is served from.
 *
 * Vercel gives a project more than one address — the auto-generated
 * gym-web-ten-puce.vercel.app and the shorter gym-web.vercel.app both serve
 * it. ALLOWED_ORIGINS on the deployment listed only the first, so anyone who
 * had bookmarked the second had every API call refused with no CORS header.
 * It looked like "some phones can't connect": the site loaded, the API said
 * no, and clearing the cache changed nothing because the refusal is by origin
 * on every request.
 *
 * The project's own addresses are therefore known here as well as in the env
 * var, so a deploy fixes it without anyone editing settings. Listed exactly,
 * never as *.vercel.app: that suffix is shared by every Vercel user, and with
 * credentials on, a wildcard would let any stranger's site call this API as a
 * signed-in member.
 */
const KNOWN_FRONTEND_ORIGINS = [
  'https://gym-web-ten-puce.vercel.app',
  'https://gym-web.vercel.app',
];

const allowedOrigins = [...new Set([
  ...KNOWN_FRONTEND_ORIGINS,
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ...(process.env.ALLOWED_ORIGINS || '').split(','),
].map(s => s.trim().replace(/\/+$/, '')).filter(Boolean))];

// Local development origins are always allowed off-production. Without this the
// only way to run the frontend against this API was to add localhost to the
// deployed ALLOWED_ORIGINS, which meant production trusted a developer laptop.
/**
 * Origins that count as "this developer's own machine or network".
 *
 * localhost alone was not enough. CRA prints an "On Your Network" address —
 * http://192.168.x.x:3000 — and opening the site through it, or from a phone
 * on the same wifi, sends that LAN address as the Origin. It was rejected, so
 * every request died with "No 'Access-Control-Allow-Origin' header", which
 * the frontend reported as the server being unreachable.
 *
 * The three private ranges (RFC 1918) and .local names are unroutable from
 * the internet, so allowing them here exposes nothing — and this branch is
 * skipped entirely in production, where only ALLOWED_ORIGINS applies.
 */
const isLocalOrigin = origin => /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)(?::\d+)?$/i.test(origin);

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
      /**
       * Deliberately short, and the reason deployments used to come up with
       * "database unavailable".
       *
       * A cold lambda has one budget for everything: its own init, loading
       * every route module, the Atlas TLS handshake, and the query. Allowing
       * 8s for server selection alone left nothing for the rest, so the first
       * requests after a deploy were killed by the platform before this code
       * could answer — and the frontend read that as the database being down.
       *
       * Four seconds is far more than a healthy Atlas needs, and it leaves
       * room for the retry below, which is what actually rescues a cold start
       * that loses its first race.
       */
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 4000,
      // Long enough for a slow aggregate, short enough that a dead socket is
      // not held onto across invocations.
      socketTimeoutMS: 20000,
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

/**
 * Says whether this instance can actually reach the database.
 *
 * Deliberately outside the guard above, so it still answers when the database
 * is unreachable — a health check that goes down with the thing it reports on
 * is no use. `db` is the mongoose readyState in words.
 */
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
    /**
     * One immediate retry.
     *
     * The failure that matters here is a cold start losing its first race to
     * Atlas — DNS not yet warm, the handshake a little slow. That attempt has
     * already primed the resolver and the TLS session, so the second one
     * almost always lands, and it costs the user a moment instead of an
     * error page. A database that is genuinely down fails twice, quickly, and
     * still answers well inside the function's budget.
     */
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


// ── Apply rate limiters before routes ─────────────────────────────────────────
/**
 * The strict limiter belongs on the endpoints that ACCEPT credentials, not on
 * the whole /api/auth namespace.
 *
 * It used to cover everything under /api/auth, and that includes GET /auth/me,
 * which the app calls on every page load. Thirty page loads in fifteen minutes
 * — an ordinary session on a phone — and the next /auth/me returned 429, which
 * the client reads as a dead session and bounces to the login screen.
 *
 * Worse on a gym's wifi: the limit is keyed by IP, and behind one NAT every
 * member shares a counter, so a handful of people browsing locked everyone out.
 *
 * Brute force is only a risk where a password is guessed, so login and register
 * keep the strict limit and everything else uses the general one.
 */
app.use('/api/auth', enforceJwtSecret); // weak or missing secret → 503 with the fix, not a forgeable session
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
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
  const PORT = Number(process.env.PORT) || 5000;
  const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

  /**
   * A busy port used to end in an unhandled 'error' event: twenty lines of
   * stack trace ending in EADDRINUSE, which says the port is taken but not
   * what took it. In practice the culprit was another project's dev server,
   * and the frontend then talked to THAT backend — logins failed against a
   * perfectly good account because the request never reached this API.
   *
   * So say what is holding the port and how to deal with it. Nothing is
   * killed here: this process has no business terminating a program it did
   * not start.
   */
  server.on('error', err => {
    if (err.code !== 'EADDRINUSE') throw err;

    let holder = '';
    try {
      const { execSync } = require('child_process');
      const sh = c => execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (process.platform !== 'win32') {
        const pid = sh(`lsof -tiTCP:${PORT} -sTCP:LISTEN`).split('\n')[0];
        if (pid) {
          const cmd = sh(`ps -o command= -p ${pid}`).slice(0, 60);
          let dir = '';
          try { dir = sh(`lsof -a -p ${pid} -d cwd -Fn`).split('\n').find(l => l[0] === 'n').slice(1); } catch { /* not available */ }
          holder = `\n  Held by pid ${pid}: ${cmd}${dir ? `\n  Running in: ${dir}` : ''}`;
        }
      }
    } catch { /* lsof missing or nothing found — the advice below still stands */ }

    console.error(
      `\n❌ Port ${PORT} is already in use, so this server did not start.${holder}\n\n` +
      `  If that is an old copy of THIS server, stop it and try again:\n` +
      `      npm run dev            (frees the port first, then starts)\n\n` +
      `  If it belongs to a different project, leave it alone and use another port:\n` +
      `      PORT=5001 npm start\n` +
      `  — then set REACT_APP_API_URL=http://localhost:5001/api in the frontend's\n` +
      `    .env.development.local, or the site will talk to the wrong backend.\n`,
    );
    process.exit(1);
  });
}

module.exports = app;
