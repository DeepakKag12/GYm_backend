/**
 * Is the JWT signing secret actually secret?
 *
 * Every session token is signed with JWT_SECRET, and anyone who knows it can
 * mint an admin token without a password. The local .env shipped with a
 * template value, and the production deployment was found to be using the
 * same one — a forged token signed with that string was accepted by the live
 * API. Nothing in the code noticed, because a weak secret signs and verifies
 * exactly as well as a strong one.
 *
 * So the server checks. In production a bad secret disables sign-in and
 * token verification with a message that says what to set; public pages are
 * unaffected. In development it only warns, so a fresh checkout still runs.
 */
const MIN_LENGTH = 32;

// Words that appear in template and tutorial values, not in generated ones.
const PLACEHOLDER = /your[_-]?|change[_-]?me|example|placeholder|jwt[_-]?secret|my[_-]?secret|super[_-]?secret|123456|password|^test/i;

const isProduction = () =>
  process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

/** @returns {string|null} a plain-words problem, or null when the secret is fine */
function jwtSecretProblem() {
  const s = process.env.JWT_SECRET || '';
  if (!s) return 'JWT_SECRET is not set.';
  if (s.length < MIN_LENGTH) return `JWT_SECRET is only ${s.length} characters long; it must be at least ${MIN_LENGTH}.`;
  if (PLACEHOLDER.test(s)) return 'JWT_SECRET looks like a placeholder value.';
  return null;
}

const FIX = 'Set a strong JWT_SECRET in the deployment environment variables (for example: openssl rand -hex 48) and redeploy.';

/** Problem to enforce right now — only in production. */
function enforcedProblem() {
  return isProduction() ? jwtSecretProblem() : null;
}

/** Express middleware for the auth routes: refuse to sign in on a weak secret. */
function enforceJwtSecret(req, res, next) {
  const problem = enforcedProblem();
  if (!problem) return next();
  res.status(503).json({ message: `Sign-in is disabled until the server is configured. ${problem} ${FIX}` });
}

/** Log once at boot, loudly, in every environment. */
function reportJwtSecretAtBoot() {
  const problem = jwtSecretProblem();
  if (!problem) return;
  const level = isProduction() ? 'error' : 'warn';
  console[level](`${isProduction() ? '❌' : '⚠️ '} ${problem} ${isProduction() ? 'Sign-in is DISABLED.' : 'Fine for local development, but'} ${FIX}`);
}

module.exports = { jwtSecretProblem, enforcedProblem, enforceJwtSecret, reportJwtSecretAtBoot, FIX };
