const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
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
  orderStatus:   { type: String, enum: ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'placed' },
  notes:        { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
