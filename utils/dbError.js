/**
 * Turn database errors into answers a person can act on.
 *
 * Routes were doing `catch (err) { res.status(500).json({ message: err.message }) }`,
 * so a duplicate email reached the admin as
 *   500 "Plan executor error during findAndModify :: caused by :: E11000 duplicate key…"
 * and a missing field as
 *   500 "User validation failed: email: Path `email` is required."
 *
 * Both are the caller's mistake, not a server fault: they are 400s, and they
 * should name the field in plain words.
 */

const FIELD_LABELS = {
  email: 'email address',
  phone: 'phone number',
  name: 'name',
  membershipPlan: 'membership plan',
  membershipStatus: 'membership status',
  gender: 'gender',
  password: 'password',
};

const label = f => FIELD_LABELS[f] || f;
const withArticle = f => {
  const l = label(f);
  return `${/^[aeiou]/i.test(l) ? 'an' : 'a'} ${l}`;
};

/**
 * @returns {{status:number, message:string}} ready to send
 */
function describeDbError(err, fallback = 'Something went wrong. Please try again.') {
  // Unique index violation — e.g. two members with the same email.
  if (err && (err.code === 11000 || err.code === 11001)) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'value';
    return { status: 400, message: `That ${label(field)} is already used by someone else.` };
  }

  // Schema validation — required fields and enum values.
  if (err && err.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    if (first) {
      if (first.kind === 'required') {
        return { status: 400, message: `Please provide ${withArticle(first.path)}.` };
      }
      if (first.kind === 'enum' || first.name === 'CastError') {
        return { status: 400, message: `"${first.value}" is not a valid ${label(first.path)}.` };
      }
      return { status: 400, message: first.message };
    }
    return { status: 400, message: 'Some of the details are not valid.' };
  }

  // A malformed id in the URL.
  if (err && err.name === 'CastError' && err.kind === 'ObjectId') {
    return { status: 400, message: 'That record id is not valid.' };
  }

  return { status: 500, message: (err && err.message) || fallback };
}

/** Send it. `res.status(...).json(...)` in one call. */
function sendDbError(res, err, fallback) {
  const { status, message } = describeDbError(err, fallback);
  if (status === 500) console.error('Unhandled DB error:', err);
  return res.status(status).json({ message });
}

module.exports = { describeDbError, sendDbError };
