require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

const app = express();

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// MongoDB connection — connect once, reuse connection across serverless invocations
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGO_URI);
  isConnected = true;
  console.log('✅ MongoDB connected');
}

connectDB().catch(err => console.error('MongoDB connection error:', err));

// Export for Vercel serverless; also listen locally
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

module.exports = app;
