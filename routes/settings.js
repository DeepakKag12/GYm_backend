const express = require('express');
const router = express.Router();
const SiteSettings = require('../models/SiteSettings');
const cache = require('../utils/cache');
const { protect, adminOnly } = require('../middleware/auth');
const { sendDbError } = require('../utils/dbError');

const CACHE_KEY = 'site:settings';

/**
 * Gym details, readable by anyone and writable only by an admin.
 *
 * The read is public and unauthenticated on purpose: the navbar and footer of
 * the marketing site need it, and a visitor has no token.
 */

/** Shape sent to the browser — never the mongo internals. */
function present(doc) {
  return {
    gymName: doc.gymName,
    ownerName: doc.ownerName,
    tagline: doc.tagline,
    phone: doc.phone,
    // One number covers both for most gyms, so an empty WhatsApp means "same".
    whatsapp: doc.whatsapp || doc.phone,
    email: doc.email,
    instagram: doc.instagram,
    address: doc.address,
    hours: doc.hours || [],
    updatedAt: doc.updatedAt,
  };
}

// GET /api/settings — public
router.get('/', async (req, res) => {
  try {
    const data = await cache.getOrSet(CACHE_KEY, 300, async () => {
      const doc = await SiteSettings.getSettings();
      return present(doc);
    });
    res.json(data);
  } catch (err) { sendDbError(res, err, 'Could not load the gym details.'); }
});

// PUT /api/settings — admin only
router.put('/', protect, adminOnly, async (req, res) => {
  try {
    // Whitelisted: a request body must not be able to set `key`, `updatedBy`
    // or anything else the schema happens to gain later.
    const ALLOWED = [
      'gymName', 'ownerName', 'tagline',
      'phone', 'whatsapp', 'email', 'instagram', 'address',
    ];

    const doc = await SiteSettings.getSettings();
    for (const field of ALLOWED) {
      if (req.body[field] !== undefined) doc[field] = String(req.body[field]).trim();
    }

    if (req.body.hours !== undefined) {
      const lines = Array.isArray(req.body.hours)
        ? req.body.hours
        : String(req.body.hours).split('\n');
      doc.hours = lines.map(l => String(l).trim()).filter(Boolean).slice(0, 6);
    }

    if (!doc.gymName) return res.status(400).json({ message: 'The gym needs a name.' });
    if (!doc.phone)   return res.status(400).json({ message: 'A contact phone number is required.' });

    doc.updatedBy = req.user._id;
    await doc.save();

    // The public read is cached for 5 minutes; without this the site would show
    // the old number for that long after an edit.
    cache.del(CACHE_KEY);

    res.json({ message: 'Gym details updated.', settings: present(doc) });
  } catch (err) { sendDbError(res, err, 'Could not save the gym details.'); }
});

module.exports = router;
