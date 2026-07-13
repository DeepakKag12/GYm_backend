const mongoose = require('mongoose');

const exerciseSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String },
  instructions: { type: String },
  muscleGroup: {
    type: String,
    enum: ['chest', 'back', 'shoulders', 'arms', 'biceps', 'triceps', 'legs', 'glutes', 'core', 'abs', 'cardio', 'full-body', 'other'],
    required: true
  },
  difficulty:  { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  equipmentNeeded: { type: String },
  sets:        { type: String },
  reps:        { type: String },
  duration:    { type: String },
  image:       { type: String, default: '' },
  video:       { type: String, default: '' },      // Cloudinary uploaded video URL
  videoPublicId: { type: String, default: '' },
  videoUrl:    { type: String, default: '' },      // YouTube / external video URL
  // Visibility
  isPublic:    { type: Boolean, default: true },   // Public = visible to all
  assignedTo:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Specific members
  uploadedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tags:        [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('Exercise', exerciseSchema);
