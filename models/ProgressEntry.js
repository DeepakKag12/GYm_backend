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

module.exports = mongoose.model('ProgressEntry', progressEntrySchema);
