const mongoose = require('mongoose');

/**
 * One money-in event.
 *
 * Membership income previously had no record at all. It was inferred at read
 * time as SUM(feeAmount) over users where feePaid is true — a snapshot of what
 * each member is *currently* charged, not a history of what was actually taken.
 * Two consequences:
 *
 *   • Renewing a member overwrote feeAmount, so the renewal added nothing.
 *     A member on ₹1,500/month for a year still counted as ₹1,500 of revenue.
 *   • Revenue could not be broken down by month, because nothing carried a date.
 *
 * Every payment is now its own row, so reports can sum a real period and the
 * Payments screen can separate membership income from shop income.
 */
const paymentSchema = new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  /** Where the money came from. Drives the split on the Payments screen. */
  source: {
    type: String,
    enum: ['membership', 'store'],
    required: true,
    index: true,
  },

  amount: { type: Number, required: true, min: 0 },

  /** Why this payment exists — a first fee, a renewal, or a shop order. */
  kind: {
    type: String,
    enum: ['new-membership', 'renewal', 'order', 'adjustment'],
    default: 'new-membership',
  },

  method: { type: String, enum: ['cash', 'upi', 'card', 'online', 'other'], default: 'cash' },

  /** Set for store payments so a row can be traced back to its order. */
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

  /** Membership period this payment bought, for renewals. */
  periodStart: { type: Date },
  periodEnd:   { type: Date },

  note:       { type: String, trim: true },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  /**
   * Guards against the same event being banked twice — a retried renewal, or a
   * double-submitted form. Sparse, so rows without one do not all collide.
   */
  idempotencyKey: { type: String, default: undefined, index: { unique: true, sparse: true } },
}, { timestamps: true });

// Reports group by month and by source; the list is newest-first.
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ source: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
