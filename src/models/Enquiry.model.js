const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema({
  name:    { type: String, required: true },
  phone:   { type: String, required: true },
  email:   { type: String },
  message: { type: String, required: true },
  interest: { type: String, enum: ['membership', 'personal-training', 'diet-plan', 'supplements', 'general'], default: 'general' },
  status:  { type: String, enum: ['new', 'contacted', 'converted', 'closed'], default: 'new' },
  notes:   { type: String },

  /**
   * Reply tracking, so an enquiry cannot quietly go unanswered.
   *
   * `status` alone was not enough: an admin could mark someone "contacted"
   * without ever writing to them, and nothing recorded when or how a reply
   * actually went out.
   */
  repliedAt:     { type: Date, default: null },
  replyCount:    { type: Number, default: 0 },
  lastReplyBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // 'opened' rather than 'sent' for WhatsApp: a wa.me link hands the message to
  // the admin's own app, and the server cannot know they pressed send.
  lastWhatsAppAt: { type: Date, default: null },
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
// The admin list is always "newest first"; the dashboard counts unanswered ones.
enquirySchema.index({ createdAt: -1 });
enquirySchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
