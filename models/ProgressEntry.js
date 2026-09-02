const mongoose = require('mongoose');

const progressEntrySchema = new mongoose.Schema({
  member:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:     { type: Date, default: Date.now },
  weight:   { type: Number },          // kg
  bodyFat:  { type: Number },          // %
  chest:    { type: Number },          // cm
  waist:    { type: Number },          // cm
  hips:     { type: Number },          // cm
  arms:     { type: Number },          // cm (bicep)
  thighs:   { type: Number },          // cm
  notes:    { type: String },
  photo:    { type: String },          // Cloudinary URL
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
// Every read is "this member's entries, newest first".
progressEntrySchema.index({ member: 1, date: -1 });

module.exports = mongoose.model('ProgressEntry', progressEntrySchema);
