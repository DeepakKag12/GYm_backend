const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  /**
   * Client-supplied key that makes checkout safe to retry.
   *
   * A double-tapped Place Order button, or a retry after a flaky connection,
   * would otherwise create a second order and decrement stock twice. The
   * browser sends the same key for both attempts; the second finds the first
   * order and returns it instead of creating another.
   *
   * Sparse so that orders created before this existed — and any future path
   * that omits it — do not all collide on null.
   */
  idempotencyKey: { type: String, default: undefined, index: { unique: true, sparse: true } },

  /** Set once stock has been returned, so a cancel can never refund it twice. */
  stockRestored: { type: Boolean, default: false },

  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name:     String,
    price:    Number,
    quantity: Number,
    flavor:   String,
    weight:   String,
    image:    String
  }],
  shippingAddress: {
    name:    String,
    phone:   String,
    address: String,
    city:    String,
    state:   String,
    pincode: String,
  },
  totalAmount:  { type: Number, required: true },
  paymentMethod: { type: String, enum: ['cod', 'online', 'upi'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  // Gym-pickup order flow: placed → confirmed → ready → collected → cancelled
  orderStatus:   { type: String, enum: ['placed', 'confirmed', 'ready', 'collected', 'cancelled'], default: 'placed' },
  notes:        { type: String },
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
