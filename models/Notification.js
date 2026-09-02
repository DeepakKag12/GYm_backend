const mongoose = require('mongoose');

/**
 * Per-channel delivery record. `status`:
 *   sent    — the provider accepted the message (ref = Twilio SID / SMTP message id)
 *   failed  — the provider rejected it (error holds the reason)
 *   skipped — not attempted: channel unconfigured, no number/address, or opted out
 */
const deliverySchema = new mongoose.Schema({
  status: { type: String, enum: ['sent', 'failed', 'skipped'] },
  ref:    { type: String },
  error:  { type: String },
  at:     { type: Date },
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  member:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // 'announcement' and 'welcome' were missing: the admin compose screen posts
  // type:'announcement', which failed enum validation and 500'd every broadcast.
  type: {
    type: String,
    enum: [
      'fee-reminder', 'diet-assigned', 'exercise-assigned', 'general',
      'membership-expired', 'announcement', 'welcome', 'order',
    ],
    required: true,
  },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  isRead:   { type: Boolean, default: false },
  sentVia:  [{ type: String, enum: ['website', 'whatsapp', 'email'] }],
  // Per-channel outcome, written by services/notify.js after the parallel send.
  delivery: {
    whatsapp: deliverySchema,
    email:    deliverySchema,
  },
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
notificationSchema.index({ member: 1, createdAt: -1 });
notificationSchema.index({ member: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
