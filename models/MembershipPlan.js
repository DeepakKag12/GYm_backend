const mongoose = require('mongoose');

const membershipPlanSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },   // e.g. "Monthly", "Yearly"
  slug:        { type: String, required: true, unique: true }, // e.g. "monthly"
  durationDays:{ type: Number, required: true },               // 30, 90, 180, 365
  price:       { type: Number, required: true },
  features:    [{ type: String }],
  isPopular:   { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('MembershipPlan', membershipPlanSchema);
