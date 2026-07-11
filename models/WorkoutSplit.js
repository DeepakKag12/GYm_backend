const mongoose = require('mongoose');

// A day within a weekly split
const daySchema = new mongoose.Schema({
  day:       { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], required: true },
  focus:     { type: String },             // e.g. "Chest + Triceps"
  exercises: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Exercise' }],
  notes:     { type: String },
}, { _id: false });

const workoutSplitSchema = new mongoose.Schema({
  title:     { type: String, required: true },  // e.g. "Push Pull Legs"
  member:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // null = default for all
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // trainer/admin
  days:      [daySchema],
  goal:      { type: String, enum: ['strength','muscle','fat_loss','endurance','general'], default: 'general' },
  isDefault: { type: Boolean, default: false },  // shown to all members without personal split
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('WorkoutSplit', workoutSplitSchema);
