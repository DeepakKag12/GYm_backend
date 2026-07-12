require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');

const app = express();

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ useTempFiles: true, tempFileDir: '/tmp/' }));
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
