const mongoose = require('mongoose');

const transformationSchema = new mongoose.Schema({
  member:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:        { type: String, required: true },
  description:  { type: String },
  beforeImage:  { type: String, required: true },
  afterImage:   { type: String, required: true },
  duration:     { type: String },      // e.g. "3 months"
  weightLost:   { type: String },
  muscleGained: { type: String },
  isPublic:     { type: Boolean, default: true },
  uploadedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
// Public gallery (isPublic + newest first) and the admin list.
transformationSchema.index({ isPublic: 1, createdAt: -1 });
transformationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transformation', transformationSchema);
