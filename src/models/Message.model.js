const mongoose = require('mongoose');

/**
 * Deterministic conversation ID for two users.
 * Sorting the two string IDs ensures both users share the exact same room & conversation thread.
 */
function getConversationId(id1, id2) {
  if (!id1 || !id2) return '';
  return [String(id1), String(id2)].sort().join(':');
}

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 3000,
  },
  attachments: [{
    url: { type: String, trim: true },
    name: { type: String, trim: true },
    fileType: { type: String, trim: true },
  }],
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
  readAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

// Compound indexes for high performance querying
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ recipient: 1, isRead: 1 });
messageSchema.index({ sender: 1, createdAt: -1 });

module.exports = {
  Message: mongoose.model('Message', messageSchema),
  getConversationId,
};
