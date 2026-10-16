const LandingConfig = require('../models/LandingConfig.model');
const cache = require('../utils/cache');
const asyncHandler = require('../utils/asyncHandler');
const { sendDbError } = require('../utils/dbError');

const CACHE_KEY = 'site:landing_config';

// GET /api/landing - Public config for the landing page
const getLandingConfig = asyncHandler(async (req, res) => {
  try {
    const config = await cache.getOrSet(CACHE_KEY, 300, async () => {
      const doc = await LandingConfig.getConfig();
      return doc.toObject();
    });
    res.json(config);
  } catch (err) {
    sendDbError(res, err, 'Could not retrieve landing page configuration.');
  }
});

// PUT /api/landing - Admin only, update landing configuration
const updateLandingConfig = asyncHandler(async (req, res) => {
  try {
    const doc = await LandingConfig.getConfig();

    const ALLOWED_SECTIONS = [
      'theme',
      'hero',
      'about',
      'programs',
      'featuredPrograms',
      'parallax',
      'memberResults',
      'team',
      'timings',
      'policies',
      'cafe',
      'membership',
      'sectionVisibility',
    ];

    for (const section of ALLOWED_SECTIONS) {
      if (req.body[section] !== undefined) {
        if (typeof req.body[section] === 'object' && !Array.isArray(req.body[section])) {
          // Merge nested objects or replace
          doc[section] = { ...doc[section].toObject(), ...req.body[section] };
        } else {
          doc[section] = req.body[section];
        }
        doc.markModified(section);
      }
    }

    doc.updatedBy = req.user?._id;
    await doc.save();

    // Invalidate cache
    cache.del(CACHE_KEY);

    res.json({
      message: 'Landing page configuration updated successfully.',
      config: doc.toObject(),
    });
  } catch (err) {
    sendDbError(res, err, 'Could not update landing page configuration.');
  }
});

module.exports = {
  getLandingConfig,
  updateLandingConfig,
};
