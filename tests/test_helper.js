/**
 * Test Helper for FitNation Backend Test Suites
 *
 * Safety Invariants:
 * 1. Strictly forces MONGO_URI to local test DB: mongodb://127.0.0.1:27017/fitnation_test
 * 2. Mocks/stubs outbound Meta WhatsApp and Brevo/Nodemailer email at module boundaries.
 * 3. Mocks Cloudinary upload/destroy at module boundary.
 * 4. Never touches production data or sends real notifications.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-antigravity-audits-minimum-32-chars';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/fitnation_test';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const whatsapp = require('../src/utils/whatsapp');
const email = require('../src/utils/email');
const cloudinary = require('../src/config/cloudinary');

whatsapp.sendWhatsApp = async function mockSendWhatsApp(to, text, opts = {}) {
  return { ok: true, channel: 'whatsapp', messageId: `mock-wa-${Date.now()}`, to };
};

email.sendEmail = async function mockSendEmail(toOrOpts, subject, content = {}) {
  const to = typeof toOrOpts === 'object' ? toOrOpts.to : toOrOpts;
  return { ok: true, channel: 'email', messageId: `mock-email-${Date.now()}`, to };
};

cloudinary.uploader.upload = async function mockUpload(path, opts = {}) {
  return {
    secure_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    public_id: `mock-pub-${Date.now()}`,
  };
};

cloudinary.uploader.upload_stream = function mockUploadStream(opts, callback) {
  return {
    end: (buffer) => {
      if (typeof callback === 'function') {
        callback(null, {
          secure_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          public_id: `mock-pub-${Date.now()}`,
        });
      }
    },
  };
};

cloudinary.uploader.destroy = async function mockDestroy(publicId, opts = {}) {
  return { result: 'ok' };
};

// Database Connection Helper
const origStartSession = mongoose.startSession.bind(mongoose);
mongoose.startSession = async function (...args) {
  const session = await origStartSession(...args);
  const origWithTransaction = session.withTransaction.bind(session);
  session.withTransaction = async function (fn) {
    try {
      return await origWithTransaction(fn);
    } catch (err) {
      if (err?.message && err.message.includes('Transaction numbers are only allowed on a replica set member or mongos')) {
        return await fn();
      }
      throw err;
    }
  };
  return session;
};

async function setupTestDb() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
  }
}

async function teardownTestDb() {
  try {
    if (mongoose.connection.client) {
      await mongoose.connection.client.close(true).catch(() => {});
    }
    await mongoose.disconnect().catch(() => {});
  } finally {
    for (const h of process._getActiveHandles()) {
      if (typeof h.unref === 'function') h.unref();
    }
  }
}

async function cleanCollections(...modelNames) {
  for (const name of modelNames) {
    if (mongoose.models[name]) {
      await mongoose.models[name].deleteMany({});
    }
  }
}

function makeToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

module.exports = {
  setupTestDb,
  teardownTestDb,
  cleanCollections,
  makeToken,
};
