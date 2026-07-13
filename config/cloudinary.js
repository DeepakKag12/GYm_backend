const cloudinary = require('cloudinary').v2;

/**
 * Configure Cloudinary.
 *
 * Priority order:
 *  1. Individual vars: CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 *  2. Combined URL:    CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
 *
 * If CLOUDINARY_URL is set, the Cloudinary SDK parses it automatically when you
 * call cloudinary.config({ cloud_name, api_key, api_secret }) with undefined values
 * — BUT only if we explicitly tell it to use the URL. So we parse it ourselves.
 */
function parseCloudinaryUrl(url) {
  try {
    // Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
    const u = new URL(url);
    return {
      cloud_name: u.hostname,
      api_key:    u.username,
      api_secret: u.password,
    };
  } catch {
    return null;
  }
}

const cloudName  = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey     = process.env.CLOUDINARY_API_KEY;
const apiSecret  = process.env.CLOUDINARY_API_SECRET;
const cloudUrl   = process.env.CLOUDINARY_URL;

if (cloudName && apiKey && apiSecret) {
  // Preferred: individual env vars
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
} else if (cloudUrl) {
  // Fallback: parse combined URL
  const parsed = parseCloudinaryUrl(cloudUrl);
  if (parsed) {
    cloudinary.config(parsed);
  } else {
    console.error('❌ CLOUDINARY_URL is set but could not be parsed. Expected format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME');
  }
} else {
  console.error('❌ Cloudinary credentials not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in Vercel environment variables.');
}

module.exports = cloudinary;
