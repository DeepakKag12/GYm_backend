const mongoose = require('mongoose');

/**
 * The gym's own details — name, owner, phone, socials, hours.
 *
 * These used to be hardcoded constants copied into three frontend files
 * (Navbar, Footer, HomePage). Changing a phone number meant editing and
 * redeploying the site, and the three copies could disagree. They now live in
 * one record the admin can edit, read by the whole site.
 *
 * Deliberately a singleton: there is one gym. `getSettings()` upserts it, so
 * there is never a "settings not found" state to handle in the UI.
 */
const siteSettingsSchema = new mongoose.Schema({
  // A fixed key so the collection can only ever hold one document.
  key: { type: String, default: 'site', unique: true, immutable: true },

  gymName:   { type: String, default: 'FitNation by Ajeet', trim: true },
  ownerName: { type: String, default: 'Ajeet Kag', trim: true },
  tagline:   { type: String, default: 'Uniting a healthier world', trim: true },

  phone:     { type: String, default: '9630906906', trim: true },
  // Falls back to `phone` on read when left blank — most gyms use one number.
  whatsapp:  { type: String, default: '', trim: true },
  email:     { type: String, default: '', trim: true },
  instagram: { type: String, default: 'fitnation.by.ajeet', trim: true },
  address:   { type: String, default: '', trim: true },

  // Free text, one line per row, so a gym can write its own hours rather than
  // being forced into a weekday/weekend model that may not fit.
  hours: {
    type: [String],
    default: ['Mon–Sat: 5 AM – 11 AM', 'Mon–Sat: 4 PM – 10 PM', 'Sunday: Closed'],
  },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

/** The one settings document, created on first read. */
siteSettingsSchema.statics.getSettings = async function () {
  const existing = await this.findOne({ key: 'site' });
  if (existing) return existing;
  return this.create({ key: 'site' });
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
