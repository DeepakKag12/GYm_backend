/**
 * Demo data for a pre-launch walkthrough.
 *
 * Clears the content collections and inserts a small, believable set so every
 * screen has something real-looking to show. It does NOT touch the admin, the
 * trainers, the membership plans or the site settings — those are configuration
 * the gym has already set up.
 *
 * Every YouTube id below was checked against YouTube's oEmbed endpoint, which
 * returns the video's real title, so the clip on a card genuinely shows the
 * exercise the card names. Every image URL was fetched and looked at.
 *
 *   node scripts/seedDemo.js            seed
 *   node scripts/seedDemo.js --dry-run  show what would happen, change nothing
 *
 * This is placeholder content. Replace it with the gym's own photos and real
 * member stories before launch — the transformation photos in particular are
 * stock models, not members.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User           = require('../models/User');
const Exercise       = require('../models/Exercise');
const Product        = require('../models/Product');
const DietPlan       = require('../models/DietPlan');
const Transformation = require('../models/Transformation');
const Order          = require('../models/Order');
const Payment        = require('../models/Payment');
const Notification   = require('../models/Notification');
const Enquiry        = require('../models/Enquiry');
const ProgressEntry  = require('../models/ProgressEntry');
const WorkoutSplit   = require('../models/WorkoutSplit');

const DRY = process.argv.includes('--dry-run');
const U = (id, w = 800) => `https://images.unsplash.com/${id}?w=${w}&q=75&auto=format&fit=crop`;
const yt = id => `https://www.youtube.com/watch?v=${id}`;

/* ── Exercises ─────────────────────────────────────────────────────────────
   id → verified title, so the video matches the name on the card.           */
const EXERCISES = [
  { title: 'Barbell Bench Press',     muscleGroup: 'chest',     difficulty: 'intermediate', v: 'rT7DgCr-3pg', sets: '4', reps: '8-10', equipmentNeeded: 'Barbell, flat bench',
    description: 'The main chest builder. Lower the bar to mid-chest and press it back over your shoulders.',
    instructions: '1. Lie flat, eyes under the bar.\n2. Grip a little wider than shoulders.\n3. Lower to mid-chest, elbows about 45°.\n4. Press up without bouncing off the chest.' },
  { title: 'Pull Up',                 muscleGroup: 'back',      difficulty: 'advanced',     v: 'eGo4IYlbE5g', sets: '4', reps: '6-10', equipmentNeeded: 'Pull-up bar',
    description: 'Bodyweight pulling for the lats and upper back. Use a band if you cannot do a full set yet.',
    instructions: '1. Hang with hands just outside shoulders.\n2. Pull the chest towards the bar.\n3. Chin clears the bar.\n4. Lower all the way down under control.' },
  { title: 'Lat Pulldown',            muscleGroup: 'back',      difficulty: 'beginner',     v: 'SALxEARiMkw', sets: '3', reps: '10-12', equipmentNeeded: 'Cable pulldown machine',
    description: 'The pull-up you can load lighter. Good for learning to pull with the back and not the arms.',
    instructions: '1. Pin your knees under the pad.\n2. Pull the bar to your upper chest.\n3. Squeeze the shoulder blades down.\n4. Return slowly, do not let it yank you up.' },
  { title: 'Dumbbell Shoulder Press', muscleGroup: 'shoulders', difficulty: 'intermediate', v: 'qEwKCR5JCog', sets: '3', reps: '8-12', equipmentNeeded: 'Dumbbells, bench',
    description: 'Overhead pressing for the front and side delts.',
    instructions: '1. Sit with back supported.\n2. Start at ear height.\n3. Press up without locking hard.\n4. Lower to ear height again.' },
  { title: 'Dumbbell Lateral Raise',  muscleGroup: 'shoulders', difficulty: 'beginner',     v: '3VcKaXpzqRo', sets: '3', reps: '12-15', equipmentNeeded: 'Light dumbbells',
    description: 'Builds shoulder width. Light weight — this is not a swinging movement.',
    instructions: '1. Slight bend in the elbows.\n2. Raise out to the sides to shoulder height.\n3. Lead with the elbows.\n4. Lower slowly.' },
  { title: 'Barbell Curl',            muscleGroup: 'biceps',    difficulty: 'beginner',     v: 'kwG2ipFRgfo', sets: '3', reps: '10-12', equipmentNeeded: 'Barbell or EZ bar',
    description: 'The straightforward bicep builder.',
    instructions: '1. Elbows tucked at your sides.\n2. Curl up without swinging the hips.\n3. Squeeze at the top.\n4. Lower under control.' },
  { title: 'Tricep Pushdown',         muscleGroup: 'triceps',   difficulty: 'beginner',     v: '2-LAMcpzODU', sets: '3', reps: '12-15', equipmentNeeded: 'Cable machine',
    description: 'Isolates the triceps. Keep the upper arms still.',
    instructions: '1. Elbows pinned to your ribs.\n2. Push down until the arms are straight.\n3. Pause briefly.\n4. Return to about 90°.' },
  { title: 'Barbell Squat',           muscleGroup: 'legs',      difficulty: 'advanced',     v: 'bEv6CCg2BC8', sets: '4', reps: '6-8', equipmentNeeded: 'Barbell, squat rack',
    description: 'The main lower-body lift. Start light and get the depth right before adding weight.',
    instructions: '1. Bar on the upper back, not the neck.\n2. Brace, then sit down and back.\n3. Hips to about knee level.\n4. Drive up through the whole foot.' },
  { title: 'Romanian Deadlift',       muscleGroup: 'legs',      difficulty: 'intermediate', v: 'JCXUYuzwNrM', sets: '3', reps: '8-10', equipmentNeeded: 'Barbell',
    description: 'Hamstrings and glutes. The knees stay soft — this is a hip movement, not a squat.',
    instructions: '1. Hold the bar at the hips.\n2. Push the hips back, bar close to the legs.\n3. Stop when you feel the hamstrings.\n4. Drive the hips forward to stand.' },
  { title: 'Plank',                   muscleGroup: 'core',      difficulty: 'beginner',     v: 'pSHjTRCQxIw', sets: '3', reps: '30-60 sec', duration: '45 sec', equipmentNeeded: 'None',
    description: 'Teaches the core to hold a straight line. Quality beats time.',
    instructions: '1. Elbows under the shoulders.\n2. Squeeze the glutes.\n3. Straight line from head to heels.\n4. Breathe — do not hold your breath.' },
];

/* ── Products ─────────────────────────────────────────────────────────────── */
const PRODUCTS = [
  { name: 'Gold Standard Whey Protein',  category: 'protein',       brand: 'Optimum Nutrition', price: 4499, discountPrice: 3799, stock: 24, isFeatured: true,
    img: 'photo-1610725664285-7c57e6eeac3f', flavors: ['Chocolate', 'Vanilla', 'Cookies & Cream'], weights: ['1 kg', '2 kg'],
    description: '24 g of protein per scoop. The standard first supplement — take one after training.' },
  { name: 'Serious Mass Weight Gainer',  category: 'weight-gainer', brand: 'Optimum Nutrition', price: 3899, discountPrice: 3299, stock: 12,
    img: 'photo-1593095948071-474c5cc2989d', flavors: ['Chocolate', 'Banana'], weights: ['3 kg', '5.4 kg'],
    description: 'High-calorie shake for members who struggle to eat enough to gain weight.' },
  { name: 'Micronised Creatine Monohydrate', category: 'creatine',  brand: 'MuscleBlaze', price: 1299, discountPrice: 999, stock: 30, isFeatured: true,
    img: 'photo-1526947425960-945c6e72858f', flavors: ['Unflavoured'], weights: ['250 g'],
    description: '3–5 g a day, any time. The most researched supplement there is for strength.' },
  { name: 'Whey Protein Bar (Box of 12)', category: 'protein',      brand: 'Yoga Bar', price: 1199, discountPrice: 999, stock: 40,
    img: 'photo-1622484212850-eb596d769edc', flavors: ['Chocolate Brownie', 'Peanut Butter'], weights: ['12 × 60 g'],
    description: '20 g protein per bar. For the days you cannot get a real meal in after training.' },
  { name: 'Daily Multivitamin',          category: 'vitamins',      brand: 'Wellman', price: 899, discountPrice: 749, stock: 35,
    img: 'photo-1607619056574-7b8d3ee536b2', weights: ['60 tablets'],
    description: 'One tablet a day to cover the gaps when training loads are high.' },
  { name: 'Omega-3 Fish Oil',            category: 'vitamins',      brand: 'Neuherbs', price: 999, discountPrice: 799, stock: 28,
    img: 'photo-1631549916768-4119b2e5f926', weights: ['60 softgels'],
    description: 'Supports joints and recovery. Two softgels with a meal.' },
  { name: 'Pre-Workout Energy Blend',    category: 'pre-workout',   brand: 'MuscleBlaze', price: 1899, discountPrice: 1599, stock: 18, isFeatured: true,
    img: 'photo-1612817288484-6f916006741a', flavors: ['Fruit Punch', 'Green Apple'], weights: ['250 g'],
    description: 'Caffeine and beta-alanine, 20 minutes before training. Skip it in the evening.' },
  { name: 'Resistance Band Set',         category: 'accessories',   brand: 'Boldfit', price: 1299, discountPrice: 899, stock: 22,
    img: 'photo-1584735935682-2f2b69dff9d2', weights: ['5 bands'],
    description: 'Five strengths for warm-ups, assisted pull-ups and training at home.' },
  { name: 'Adjustable Dumbbell Pair',    category: 'accessories',   brand: 'Kore', price: 6499, discountPrice: 5499, stock: 8,
    img: 'photo-1534438327276-14e5300c3a48', weights: ['2 × 20 kg'],
    description: 'One pair that replaces a rack. Good for a home setup.' },
  { name: 'FitNation Training Hoodie',   category: 'apparel',       brand: 'FitNation', price: 1799, discountPrice: 1499, stock: 26,
    img: 'photo-1615397587950-3cbb55f95b77', weights: ['S', 'M', 'L', 'XL'],
    description: 'Cotton-blend hoodie with the gym logo. Sizes S to XL.' },
];

/* ── Diet plans ───────────────────────────────────────────────────────────── */
const DIETS = [
  { title: 'Fat Loss — 1,600 kcal', goal: 'weight-loss', totalCalories: 1600, totalProtein: '130 g', img: 'photo-1490645935967-10de6ba17061',
    description: 'A steady deficit with the protein kept high, so the weight that comes off is fat and not muscle.',
    meals: [
      { mealType: 'breakfast', time: '8:00 AM', items: [ { name: 'Egg white omelette (4 whites, 1 whole)', quantity: '1 plate', calories: 220, protein: '22 g', carbs: '3 g', fat: '11 g' }, { name: 'Multigrain toast', quantity: '2 slices', calories: 160, protein: '6 g', carbs: '28 g', fat: '2 g' } ] },
      { mealType: 'lunch', time: '1:00 PM', items: [ { name: 'Grilled chicken breast', quantity: '150 g', calories: 250, protein: '46 g', carbs: '0 g', fat: '6 g' }, { name: 'Brown rice', quantity: '1 cup', calories: 215, protein: '5 g', carbs: '45 g', fat: '2 g' }, { name: 'Mixed salad', quantity: '1 bowl', calories: 60, protein: '2 g', carbs: '10 g', fat: '1 g' } ] },
      { mealType: 'snack', time: '5:00 PM', items: [ { name: 'Greek yoghurt', quantity: '150 g', calories: 130, protein: '15 g', carbs: '8 g', fat: '4 g' }, { name: 'Apple', quantity: '1', calories: 95, protein: '0 g', carbs: '25 g', fat: '0 g' } ] },
      { mealType: 'dinner', time: '8:30 PM', items: [ { name: 'Grilled fish', quantity: '150 g', calories: 230, protein: '38 g', carbs: '0 g', fat: '8 g' }, { name: 'Steamed vegetables', quantity: '1 bowl', calories: 80, protein: '4 g', carbs: '14 g', fat: '1 g' } ] },
    ] },
  { title: 'Muscle Gain — 2,800 kcal', goal: 'muscle-gain', totalCalories: 2800, totalProtein: '180 g', img: 'photo-1512621776951-a57141f2eefd',
    description: 'A surplus built on real food, with protein spread across the day rather than crammed into one meal.',
    meals: [
      { mealType: 'breakfast', time: '7:30 AM', items: [ { name: 'Oats with milk and banana', quantity: '1 large bowl', calories: 450, protein: '18 g', carbs: '70 g', fat: '10 g' }, { name: 'Boiled eggs', quantity: '3', calories: 220, protein: '19 g', carbs: '2 g', fat: '15 g' } ] },
      { mealType: 'pre-workout', time: '11:00 AM', items: [ { name: 'Peanut butter toast', quantity: '2 slices', calories: 340, protein: '12 g', carbs: '36 g', fat: '17 g' } ] },
      { mealType: 'post-workout', time: '1:30 PM', items: [ { name: 'Whey protein shake', quantity: '1 scoop', calories: 130, protein: '24 g', carbs: '4 g', fat: '2 g' }, { name: 'Banana', quantity: '1', calories: 105, protein: '1 g', carbs: '27 g', fat: '0 g' } ] },
      { mealType: 'lunch', time: '3:00 PM', items: [ { name: 'Chicken curry', quantity: '200 g', calories: 380, protein: '48 g', carbs: '8 g', fat: '18 g' }, { name: 'Rice and roti', quantity: '1 cup + 2', calories: 420, protein: '12 g', carbs: '82 g', fat: '5 g' } ] },
      { mealType: 'dinner', time: '9:00 PM', items: [ { name: 'Paneer bhurji', quantity: '200 g', calories: 400, protein: '28 g', carbs: '12 g', fat: '28 g' }, { name: 'Dal and salad', quantity: '1 bowl', calories: 260, protein: '14 g', carbs: '38 g', fat: '5 g' } ] },
    ] },
  { title: 'Vegetarian High Protein — 2,200 kcal', goal: 'muscle-gain', totalCalories: 2200, totalProtein: '145 g', img: 'photo-1498837167922-ddd27525d352',
    description: 'Proof that a vegetarian can hit protein without living on supplements. Paneer, dal, curd and soya do most of the work.',
    meals: [
      { mealType: 'breakfast', time: '8:00 AM', items: [ { name: 'Paneer paratha with curd', quantity: '2', calories: 480, protein: '26 g', carbs: '48 g', fat: '22 g' } ] },
      { mealType: 'lunch', time: '1:30 PM', items: [ { name: 'Rajma with rice', quantity: '1 plate', calories: 520, protein: '22 g', carbs: '86 g', fat: '9 g' }, { name: 'Curd', quantity: '1 bowl', calories: 100, protein: '9 g', carbs: '8 g', fat: '4 g' } ] },
      { mealType: 'snack', time: '5:00 PM', items: [ { name: 'Roasted chana', quantity: '50 g', calories: 190, protein: '11 g', carbs: '30 g', fat: '3 g' }, { name: 'Milk', quantity: '250 ml', calories: 150, protein: '8 g', carbs: '12 g', fat: '8 g' } ] },
      { mealType: 'dinner', time: '8:30 PM', items: [ { name: 'Soya chunk curry', quantity: '150 g', calories: 320, protein: '40 g', carbs: '22 g', fat: '8 g' }, { name: 'Roti', quantity: '3', calories: 300, protein: '9 g', carbs: '60 g', fat: '3 g' } ] },
    ] },
  { title: 'Maintenance — 2,000 kcal', goal: 'maintenance', totalCalories: 2000, totalProtein: '120 g', img: 'photo-1467003909585-2f8a72700288',
    description: 'For members who are happy with their weight and want to hold it while they keep training.',
    meals: [
      { mealType: 'breakfast', time: '8:00 AM', items: [ { name: 'Poha with peanuts', quantity: '1 plate', calories: 350, protein: '9 g', carbs: '58 g', fat: '10 g' }, { name: 'Boiled eggs', quantity: '2', calories: 145, protein: '13 g', carbs: '1 g', fat: '10 g' } ] },
      { mealType: 'lunch', time: '1:00 PM', items: [ { name: 'Chicken or paneer with roti', quantity: '1 plate', calories: 560, protein: '42 g', carbs: '52 g', fat: '18 g' } ] },
      { mealType: 'snack', time: '5:00 PM', items: [ { name: 'Sprouts salad', quantity: '1 bowl', calories: 180, protein: '12 g', carbs: '28 g', fat: '2 g' } ] },
      { mealType: 'dinner', time: '8:30 PM', items: [ { name: 'Dal, sabzi and rice', quantity: '1 plate', calories: 520, protein: '20 g', carbs: '80 g', fat: '12 g' } ] },
    ] },
  { title: 'Beginner Starter Plan — 1,900 kcal', goal: 'general', totalCalories: 1900, totalProtein: '110 g', img: 'photo-1546069901-ba9599a7e63c',
    description: 'Simple food, nothing exotic. Meant for a first month, so nobody has to shop at a health store to follow it.',
    meals: [
      { mealType: 'breakfast', time: '8:00 AM', items: [ { name: 'Milk and cornflakes', quantity: '1 bowl', calories: 300, protein: '12 g', carbs: '50 g', fat: '6 g' }, { name: 'Banana', quantity: '1', calories: 105, protein: '1 g', carbs: '27 g', fat: '0 g' } ] },
      { mealType: 'lunch', time: '1:00 PM', items: [ { name: 'Roti, dal and sabzi', quantity: '1 plate', calories: 520, protein: '20 g', carbs: '78 g', fat: '12 g' }, { name: 'Curd', quantity: '1 bowl', calories: 100, protein: '9 g', carbs: '8 g', fat: '4 g' } ] },
      { mealType: 'snack', time: '5:00 PM', items: [ { name: 'Peanuts and tea', quantity: '30 g', calories: 200, protein: '8 g', carbs: '7 g', fat: '16 g' } ] },
      { mealType: 'dinner', time: '8:30 PM', items: [ { name: 'Egg curry or paneer with rice', quantity: '1 plate', calories: 560, protein: '30 g', carbs: '62 g', fat: '20 g' } ] },
    ] },
];

/* ── Transformations ──────────────────────────────────────────────────────── */
const TRANSFORMS = [
  { name: 'Rohit Sharma',   title: 'Down 12 kg in 5 months',      duration: '5 months', weightLost: '12 kg', b: 'photo-1600180758890-6b94519a8ba6', a: 'photo-1581009146145-b5ef050c2e1e', description: 'Started with three sessions a week and a calorie target he could actually stick to.' },
  { name: 'Priya Nair',     title: 'From no training to 5 days a week', duration: '6 months', weightLost: '9 kg', b: 'photo-1544367567-0f2fcb009e0b', a: 'photo-1594381898411-846e7d193883', description: 'The habit came first. The weight followed once training was non-negotiable.' },
  { name: 'Arjun Menon',    title: 'Gained 8 kg of muscle',       duration: '8 months', muscleGained: '8 kg', b: 'photo-1552674605-db6ffd4facb5', a: 'photo-1567013127542-490d757e51fc', description: 'Ate in a surplus for the first time in his life and finally started adding weight to the bar.' },
  { name: 'Sneha Patel',    title: 'Lost 15 kg after her second child', duration: '10 months', weightLost: '15 kg', b: 'photo-1584464491033-06628f3a6b7b', a: 'photo-1541534741688-6078c6bfb5c5', description: 'Trained around a full schedule — mornings before the house woke up.' },
  { name: 'Vikram Singh',   title: 'First unassisted pull-up',    duration: '4 months', b: 'photo-1517960413843-0aee8e2b3285', a: 'photo-1616803689943-5601631c7fec', description: 'Bands, then negatives, then one clean rep. Now he does eight.' },
  { name: 'Ananya Reddy',   title: 'Squatted her own bodyweight', duration: '7 months', muscleGained: '4 kg', b: 'photo-1571019613454-1cb2f99b2d8b', a: 'photo-1532384748853-8f54a8f476e2', description: 'Started with an empty bar and added a little every week.' },
  { name: 'Karan Malhotra', title: 'Down 18 kg, off blood pressure medication', duration: '12 months', weightLost: '18 kg', b: 'photo-1600180758890-6b94519a8ba6', a: 'photo-1549476464-37392f717541', description: 'The slowest and the most complete change of anyone in the gym this year.' },
  { name: 'Meera Joshi',    title: 'Ran her first 10k',           duration: '5 months', weightLost: '7 kg', b: 'photo-1544367567-0f2fcb009e0b', a: 'photo-1550259979-ed79b48d2a30', description: 'Cardio plus two lifting days, so she kept her strength while the distance went up.' },
  { name: 'Aditya Kumar',   title: 'Deadlifted 140 kg',           duration: '9 months', muscleGained: '6 kg', b: 'photo-1552674605-db6ffd4facb5', a: 'photo-1595078475328-1ab05d0a6a0e', description: 'Technique first for three months. The numbers came after.' },
  { name: 'Divya Krishnan', title: 'Down 11 kg and kept it off a year', duration: '14 months', weightLost: '11 kg', b: 'photo-1571019613454-1cb2f99b2d8b', a: 'photo-1546483875-ad9014c88eba', description: 'The part most people miss — she stayed after she hit the goal.' },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to "${mongoose.connection.name}"${DRY ? '  [DRY RUN — nothing will change]' : ''}\n`);

  const admin = await User.findOne({ role: 'admin' });
  if (!admin) throw new Error('No admin user found. Create the admin first — this script will not invent one.');
  console.log(`Admin kept: ${admin.name} <${admin.email}>`);

  const before = {
    exercises: await Exercise.countDocuments(), products: await Product.countDocuments(),
    dietplans: await DietPlan.countDocuments(), transformations: await Transformation.countDocuments(),
    members: await User.countDocuments({ role: 'member' }),
  };
  console.log('Before:', JSON.stringify(before));

  if (DRY) {
    console.log(`\nWould insert: ${EXERCISES.length} exercises, ${PRODUCTS.length} products, ` +
      `${DIETS.length} diet plans, ${TRANSFORMS.length} transformations (+${TRANSFORMS.length} demo members).`);
    return mongoose.disconnect();
  }

  // Clear content and everything that points at a member. Admin, trainers,
  // membership plans and site settings are configuration and stay.
  await Promise.all([
    Exercise.deleteMany({}), Product.deleteMany({}), DietPlan.deleteMany({}),
    Transformation.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({}),
    Notification.deleteMany({}), Enquiry.deleteMany({}), ProgressEntry.deleteMany({}),
    WorkoutSplit.deleteMany({ member: { $ne: null } }),
    User.deleteMany({ role: 'member' }),
  ]);
  console.log('Cleared old content and members.');

  await Exercise.insertMany(EXERCISES.map(e => ({
    title: e.title, description: e.description, instructions: e.instructions,
    muscleGroup: e.muscleGroup, difficulty: e.difficulty, equipmentNeeded: e.equipmentNeeded,
    sets: e.sets, reps: e.reps, duration: e.duration,
    videoUrl: yt(e.v), isPublic: true, uploadedBy: admin._id,
    tags: [e.muscleGroup, e.difficulty],
  })));
  console.log(`✓ ${EXERCISES.length} exercises`);

  await Product.insertMany(PRODUCTS.map(p => ({
    name: p.name, description: p.description, category: p.category, brand: p.brand,
    price: p.price, discountPrice: p.discountPrice, stock: p.stock,
    images: [U(p.img)], flavors: p.flavors || [], weights: p.weights || [],
    rating: 0, reviewCount: 0, isFeatured: Boolean(p.isFeatured), isActive: true,
  })));
  console.log(`✓ ${PRODUCTS.length} products`);

  await DietPlan.insertMany(DIETS.map(d => ({
    title: d.title, description: d.description, goal: d.goal, meals: d.meals,
    totalCalories: d.totalCalories, totalProtein: d.totalProtein,
    image: U(d.img), isPublic: true, uploadedBy: admin._id,
  })));
  console.log(`✓ ${DIETS.length} diet plans`);

  // Transformations need a member to belong to, so each gets a demo account.
  const pw = await bcrypt.hash('demo1234', 10);
  const members = await User.insertMany(TRANSFORMS.map((t, i) => ({
    name: t.name,
    email: `demo${i + 1}@fitnation.demo`,
    phone: `90000000${String(i + 10).slice(-2)}`,
    password: pw, role: 'member', isActive: true,
    membershipPlan: ['monthly', 'quarterly', 'half-yearly', 'yearly'][i % 4],
    membershipStatus: 'active',
    membershipStart: new Date(Date.now() - (60 + i * 10) * 86400000),
    membershipEnd: new Date(Date.now() + (10 + i * 6) * 86400000),
    feePaid: true, feeAmount: [1500, 4000, 7000, 12000][i % 4],
  })));
  console.log(`✓ ${members.length} demo members`);

  await Transformation.insertMany(TRANSFORMS.map((t, i) => ({
    member: members[i]._id, title: t.title, description: t.description,
    beforeImage: U(t.b, 600), afterImage: U(t.a, 600),
    duration: t.duration, weightLost: t.weightLost, muscleGained: t.muscleGained,
    isPublic: true, uploadedBy: admin._id,
  })));
  console.log(`✓ ${TRANSFORMS.length} transformations`);

  // Each paid membership is real income, so the ledger must show it or the
  // Payments and Reports screens would read zero against ten paying members.
  await Payment.insertMany(members.map((m, i) => ({
    member: m._id, source: 'membership', kind: 'new-membership',
    amount: m.feeAmount, method: ['cash', 'upi', 'card'][i % 3],
    periodStart: m.membershipStart, periodEnd: m.membershipEnd,
    idempotencyKey: `demo:${m._id}:${new Date(m.membershipStart).toISOString()}`,
    recordedBy: admin._id, note: 'Demo data', createdAt: m.membershipStart,
  })));
  console.log(`✓ ${members.length} membership payments`);

  console.log('\nDone. Replace this with the gym\'s own content before launch.');
  await mongoose.disconnect();
})().catch(async e => { console.error('FAILED:', e.message); await mongoose.disconnect(); process.exit(1); });
