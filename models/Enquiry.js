const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema({
  name:    { type: String, required: true },
  phone:   { type: String, required: true },
  email:   { type: String },
  message: { type: String, required: true },
  interest: { type: String, enum: ['membership', 'personal-training', 'diet-plan', 'supplements', 'general'], default: 'general' },
  status:  { type: String, enum: ['new', 'contacted', 'converted', 'closed'], default: 'new' },
  notes:   { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Enquiry', enquirySchema);
