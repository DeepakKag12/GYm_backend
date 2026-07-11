const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  phone:        { type: String, required: true },
  whatsapp:     { type: String },
  password:     { type: String, required: true },
  role:         { type: String, enum: ['admin', 'trainer', 'member'], default: 'member' },
  avatar:       { type: String, default: '' },
  address:      { type: String },
  dob:          { type: Date },
  gender:       { type: String, enum: ['male', 'female', 'other'] },
  // Membership fields
  membershipPlan: { type: String, enum: ['monthly', 'quarterly', 'half-yearly', 'yearly'], default: 'monthly' },
  membershipStart: { type: Date },
  membershipEnd:   { type: Date },
  membershipStatus: { type: String, enum: ['active', 'expired', 'pending'], default: 'pending' },
  feePaid:      { type: Boolean, default: false },
  feeAmount:    { type: Number, default: 0 },
  assignedTrainer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Notification tracking
  reminderSent7days:  { type: Boolean, default: false },
  reminderSent3days:  { type: Boolean, default: false },
  reminderSentExpiry: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
