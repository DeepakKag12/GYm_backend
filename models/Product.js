const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String },
  category:    { type: String, enum: ['protein', 'creatine', 'pre-workout', 'vitamins', 'weight-gainer', 'fat-burner', 'bcaa', 'accessories', 'apparel', 'other'], required: true },
  brand:       { type: String },
  price:       { type: Number, required: true },
  discountPrice: { type: Number },
  stock:       { type: Number, default: 0 },
  images:      [{ type: String }],
  video:       { type: String },   // Cloudinary mp4 URL or YouTube link
  flavors:     [{ type: String }],
  weights:     [{ type: String }],   // e.g. ["1kg", "2kg", "5kg"]
  rating:      { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  reviews: [{
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name:    String,
    rating:  Number,
    comment: String,
    date:    { type: Date, default: Date.now }
  }],
  isFeatured:  { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

// ── Performance indexes ────────────────────────────────────────────────────────
productSchema.index({ isActive: 1, category: 1, createdAt: -1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ name: 'text', description: 'text' }); // text-search support

module.exports = mongoose.model('Product', productSchema);
