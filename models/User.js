const mongoose = require('mongoose');
const { canonicalPhone } = require('../utils/phone');

const userSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  // Stored as digits only. "98765 43210", "+91 98765 43210" and "9876543210"
  // are the same person, and comparing raw strings let all three coexist.
  phone:        { type: String, required: true, trim: true },
  whatsapp:     { type: String },
  password:     { type: String, required: true },
  role:         { type: String, enum: ['admin', 'trainer', 'member'], default: 'member' },
  avatar:       { type: String, default: '' },
  address:      { type: String },
  dob:          { type: Date },
  gender:       { type: String, enum: ['male', 'female', 'other'] },
  // Membership fields
  specialization: { type: String, default: '' },  // for trainers
  membershipPlan: { type: String, enum: ['monthly', 'quarterly', 'half-yearly', 'yearly'], default: 'monthly' },
  membershipStart: { type: Date },
  membershipEnd:   { type: Date },
  membershipStatus: { type: String, enum: ['active', 'expired', 'pending'], default: 'pending' },
  feePaid:      { type: Boolean, default: false },
  feeAmount:    { type: Number, default: 0 },
  assignedTrainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Notification preferences — respected by services/notify.js on every send
  notifyWhatsApp: { type: Boolean, default: true },
  notifyEmail:    { type: Boolean, default: true },
  // Notification tracking
  reminderSent7days:  { type: Boolean, default: false },
  reminderSent3days:  { type: Boolean, default: false },
  reminderSentExpiry: { type: Boolean, default: false },

  /**
   * Which reminder slot this member was last sent, as "YYYY-MM-DD-am|pm" in the
   * gym's local timezone.
   *
   * The booleans above can only ever say "sent once". The final-three-days
   * reminder goes out twice a day, so it needs to know *which* send it last
   * did — and comparing against the current slot is what stops a retried or
   * double-fired cron from messaging the same member twice in one slot.
   */
  lastReminderSlot:   { type: String, default: null },

  /**
   * When an admin last handed this member's reminder off to WhatsApp.
   *
   * Automated WhatsApp needs a registered Business sender, so today the admin
   * sends it themselves from a wa.me link. The server cannot know whether they
   * pressed send in WhatsApp — only that the message was prepared and the chat
   * opened. It is labelled "opened" in the UI for exactly that reason: it is
   * an honest record of what we know, and it is enough to answer the question
   * that matters, "who have I not got to yet".
   */
  lastWhatsAppAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
/**
 * Phone is normalised to digits before every save, so uniqueness is judged on
 * the number rather than on how it happened to be typed.
 *
 * A leading country code is kept when present but a bare Indian 10-digit number
 * is left as-is, matching how the rest of the app stores and dials them.
 */
userSchema.pre('save', function normalisePhone(next) {
  if (this.isModified('phone') && this.phone) this.phone = canonicalPhone(this.phone);
  if (this.isModified('whatsapp') && this.whatsapp) this.whatsapp = canonicalPhone(this.whatsapp);
  next();
});

// findOneAndUpdate bypasses `save` middleware, so PUT /members/:id would have
// written an unnormalised number straight past the rule above.
userSchema.pre('findOneAndUpdate', function normaliseOnUpdate(next) {
  const u = this.getUpdate() || {};
  const target = u.$set || u;
  if (target.phone) target.phone = canonicalPhone(target.phone);
  if (target.whatsapp) target.whatsapp = canonicalPhone(target.whatsapp);
  next();
});

/**
 * One account per phone number.
 *
 * Email was already unique; phone was not, so the same member could be added
 * twice under a slightly different name and the gym would chase two records for
 * one person. Partial rather than plain unique so that a blank phone — which
 * the schema forbids today but a future import might produce — does not collide
 * with every other blank.
 */
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } },
);

userSchema.index({ role: 1, membershipStatus: 1 });
userSchema.index({ role: 1, membershipEnd: 1 });
userSchema.index({ role: 1, feePaid: 1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ assignedTrainer: 1 });

module.exports = mongoose.model('User', userSchema);
