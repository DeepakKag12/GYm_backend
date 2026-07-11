const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  member:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:     { type: String, enum: ['fee-reminder', 'diet-assigned', 'exercise-assigned', 'general', 'membership-expired'], required: true },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  isRead:   { type: Boolean, default: false },
  sentVia:  [{ type: String, enum: ['website', 'whatsapp', 'email'] }],
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
