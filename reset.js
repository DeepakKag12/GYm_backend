/**
 * Production Reset Script
 * ========================
 * Wipes all transactional / demo data from the database so the app is
 * ready for real members, orders, etc.
 *
 * KEEPS:   Admin user, Trainers, Membership plans, Exercises (with videos),
 *          Diet plans, Workout splits, Products/Store items.
 *
 * DELETES: All members, All orders, All notifications, All progress entries,
 *          All enquiries, All transformations.
 *
 * Usage:
 *   node backend/reset.js
 * or from inside backend/:
 *   node reset.js
 */

require('dotenv').config();
const mongoose      = require('mongoose');
const readline      = require('readline');

const User          = require('./models/User');
const Order         = require('./models/Order');
const Notification  = require('./models/Notification');
const ProgressEntry = require('./models/ProgressEntry');
const Enquiry       = require('./models/Enquiry');
const Transformation= require('./models/Transformation');

// ── helpers ────────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const c = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── main ───────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n' + c.bold('═══════════════════════════════════════════════'));
  console.log(c.bold('   🏋️  FitNation — Production Reset Tool'));
  console.log(c.bold('═══════════════════════════════════════════════') + '\n');

  // Connect
  if (!process.env.MONGO_URI) {
    console.error(c.red('✖  MONGO_URI is not set in .env\n'));
    process.exit(1);
  }

  console.log(c.dim('Connecting to MongoDB…'));
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(c.green('✔  Connected') + '\n');

  // Show what will be deleted
  const [memberCount, orderCount, notifCount, progressCount, enquiryCount, transformCount] = await Promise.all([
    User.countDocuments({ role: 'member' }),
    Order.countDocuments({}),
    Notification.countDocuments({}),
    ProgressEntry.countDocuments({}),
    Enquiry.countDocuments({}),
    Transformation.countDocuments({}),
  ]);

  console.log(c.yellow('⚠️  The following will be PERMANENTLY DELETED:\n'));
  console.log(`   Members          →  ${c.red(memberCount)} records`);
  console.log(`   Orders           →  ${c.red(orderCount)} records`);
  console.log(`   Notifications    →  ${c.red(notifCount)} records`);
  console.log(`   Progress entries →  ${c.red(progressCount)} records`);
  console.log(`   Enquiries        →  ${c.red(enquiryCount)} records`);
  console.log(`   Transformations  →  ${c.red(transformCount)} records`);

  console.log('\n' + c.green('✔  The following will be KEPT:\n'));
  console.log('   Admin user, Trainers, Membership plans');
  console.log('   Exercises (with videos), Diet plans');
  console.log('   Workout splits, Products / Store items\n');

  if (memberCount + orderCount + notifCount + progressCount + enquiryCount + transformCount === 0) {
    console.log(c.green('✔  Nothing to delete — database is already clean!\n'));
    rl.close();
    await mongoose.disconnect();
    return;
  }

  const answer = await ask(c.bold('Type  YES  to confirm reset, anything else to cancel: '));
  if (answer.trim() !== 'YES') {
    console.log(c.yellow('\nReset cancelled. No data was changed.\n'));
    rl.close();
    await mongoose.disconnect();
    return;
  }

  console.log(c.dim('\nDeleting…'));

  const [
    membersDeleted,
    ordersDeleted,
    notifsDeleted,
    progressDeleted,
    enquiriesDeleted,
    transformsDeleted,
  ] = await Promise.all([
    User.deleteMany({ role: 'member' }).then(r => r.deletedCount),
    Order.deleteMany({}).then(r => r.deletedCount),
    Notification.deleteMany({}).then(r => r.deletedCount),
    ProgressEntry.deleteMany({}).then(r => r.deletedCount),
    Enquiry.deleteMany({}).then(r => r.deletedCount),
    Transformation.deleteMany({}).then(r => r.deletedCount),
  ]);

  console.log('\n' + c.bold('Results:'));
  console.log(`   ${c.green('✔')} Members deleted          : ${c.bold(membersDeleted)}`);
  console.log(`   ${c.green('✔')} Orders deleted           : ${c.bold(ordersDeleted)}`);
  console.log(`   ${c.green('✔')} Notifications deleted    : ${c.bold(notifsDeleted)}`);
  console.log(`   ${c.green('✔')} Progress entries deleted : ${c.bold(progressDeleted)}`);
  console.log(`   ${c.green('✔')} Enquiries deleted        : ${c.bold(enquiriesDeleted)}`);
  console.log(`   ${c.green('✔')} Transformations deleted  : ${c.bold(transformsDeleted)}`);

  console.log('\n' + c.green(c.bold('✅  Reset complete. The database is ready for real data.\n')));

  rl.close();
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(c.red('\n✖  Error: ' + err.message + '\n'));
  process.exit(1);
});
