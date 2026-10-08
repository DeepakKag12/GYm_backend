const mongoose = require('mongoose');

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

module.exports = { connectDB };
