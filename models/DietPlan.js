const mongoose = require('mongoose');

const dietPlanSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String },
  goal:        { type: String, enum: ['weight-loss', 'muscle-gain', 'maintenance', 'endurance', 'general'], default: 'general' },
  meals: [{
    mealType:    { type: String, enum: ['breakfast', 'lunch', 'dinner', 'snack', 'pre-workout', 'post-workout'] },
    items:       [{ name: String, quantity: String, calories: Number, protein: String, carbs: String, fat: String }],
    time:        { type: String },
    notes:       { type: String }
  }],
  totalCalories:  { type: Number },
  totalProtein:   { type: String },
  image:          { type: String, default: '' },
  isPublic:       { type: Boolean, default: true },
  assignedTo:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  uploadedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('DietPlan', dietPlanSchema);
