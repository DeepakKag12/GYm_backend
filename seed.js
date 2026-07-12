require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Exercise       = require('./models/Exercise');
const User           = require('./models/User');
const MembershipPlan = require('./models/MembershipPlan');
const Product        = require('./models/Product');
const DietPlan       = require('./models/DietPlan');
const WorkoutSplit   = require('./models/WorkoutSplit');
const Transformation = require('./models/Transformation');
const Notification   = require('./models/Notification');
const Order          = require('./models/Order');
const ProgressEntry  = require('./models/ProgressEntry');
const Enquiry        = require('./models/Enquiry');

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // ─────────────────────────────────────────────
  // 1. ADMIN
  // ─────────────────────────────────────────────
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    admin = await User.create({
      name: 'Ajeet', email: 'admin@fitnation.com',
      phone: '9999999999', password: await bcrypt.hash('admin123', 10),
      role: 'admin'
    });
    console.log('Admin created: admin@fitnation.com / admin123');
  } else if (admin.name === 'Ajeet Singh') {
    await User.updateOne({ _id: admin._id }, { name: 'Ajeet' });
    console.log('Admin name updated to Ajeet');
  }

  // ─────────────────────────────────────────────
  // 2. TRAINERS
  // ─────────────────────────────────────────────
  await User.deleteMany({ role: 'trainer' });
  const trainers = await User.insertMany([
    { name: 'Rahul Verma',  email: 'rahul@fitnation.com',  phone: '9876543210', password: await bcrypt.hash('trainer123', 10), role: 'trainer', gender: 'male',   isActive: true },
    { name: 'Priya Sharma', email: 'priya@fitnation.com',  phone: '9876543211', password: await bcrypt.hash('trainer123', 10), role: 'trainer', gender: 'female', isActive: true },
    { name: 'Karan Mehta',  email: 'karan@fitnation.com',  phone: '9876543212', password: await bcrypt.hash('trainer123', 10), role: 'trainer', gender: 'male',   isActive: true },
  ]);
  console.log(`✅ Seeded ${trainers.length} trainers`);

  // ─────────────────────────────────────────────
  // 3. MEMBERS
  // ─────────────────────────────────────────────
  await User.deleteMany({ role: 'member' });
  const now = new Date();
  const future = (days) => new Date(now.getTime() + days * 86400000);
  const past   = (days) => new Date(now.getTime() - days * 86400000);

  const membersData = [
    { name: 'Aman Gupta',    email: 'aman@gmail.com',    phone: '9111111111', gender: 'male',   membershipPlan: 'monthly',    membershipStart: past(10),  membershipEnd: future(20), membershipStatus: 'active',  feePaid: true,  feeAmount: 1500, assignedTrainer: trainers[0]._id },
    { name: 'Sneha Patil',   email: 'sneha@gmail.com',   phone: '9111111112', gender: 'female', membershipPlan: 'quarterly',  membershipStart: past(30),  membershipEnd: future(60), membershipStatus: 'active',  feePaid: true,  feeAmount: 3500, assignedTrainer: trainers[1]._id },
    { name: 'Rohit Joshi',   email: 'rohit@gmail.com',   phone: '9111111113', gender: 'male',   membershipPlan: 'half-yearly',membershipStart: past(60),  membershipEnd: future(120),membershipStatus: 'active',  feePaid: true,  feeAmount: 6000, assignedTrainer: trainers[0]._id },
    { name: 'Neha Singh',    email: 'neha@gmail.com',    phone: '9111111114', gender: 'female', membershipPlan: 'yearly',     membershipStart: past(90),  membershipEnd: future(275),membershipStatus: 'active',  feePaid: true,  feeAmount: 10000,assignedTrainer: trainers[2]._id },
    { name: 'Vikas Kumar',   email: 'vikas@gmail.com',   phone: '9111111115', gender: 'male',   membershipPlan: 'monthly',    membershipStart: past(5),   membershipEnd: future(3),  membershipStatus: 'active',  feePaid: false, feeAmount: 1500, assignedTrainer: trainers[1]._id },
    { name: 'Divya Rao',     email: 'divya@gmail.com',   phone: '9111111116', gender: 'female', membershipPlan: 'monthly',    membershipStart: past(40),  membershipEnd: past(10),   membershipStatus: 'expired', feePaid: false, feeAmount: 1500, assignedTrainer: trainers[2]._id },
    { name: 'Sanjay Patel',  email: 'sanjay@gmail.com',  phone: '9111111117', gender: 'male',   membershipPlan: 'quarterly',  membershipStart: past(20),  membershipEnd: future(70), membershipStatus: 'active',  feePaid: true,  feeAmount: 3500, assignedTrainer: trainers[0]._id },
    { name: 'Ankita Mishra', email: 'ankita@gmail.com',  phone: '9111111118', gender: 'female', membershipPlan: 'half-yearly',membershipStart: past(10),  membershipEnd: future(170),membershipStatus: 'active',  feePaid: true,  feeAmount: 6000, assignedTrainer: trainers[1]._id },
    { name: 'Deepak Nair',   email: 'deepak@gmail.com',  phone: '9111111119', gender: 'male',   membershipPlan: 'monthly',    membershipStart: past(2),   membershipEnd: future(28), membershipStatus: 'active',  feePaid: true,  feeAmount: 1500, assignedTrainer: trainers[2]._id },
    { name: 'Pooja Tiwari',  email: 'pooja@gmail.com',   phone: '9111111120', gender: 'female', membershipPlan: 'yearly',     membershipStart: past(100), membershipEnd: future(265),membershipStatus: 'active',  feePaid: true,  feeAmount: 10000,assignedTrainer: trainers[0]._id },
  ];
  const members = await User.insertMany(
    await Promise.all(membersData.map(async m => ({ ...m, password: await bcrypt.hash('member123', 10), role: 'member' })))
  );
  console.log(`✅ Seeded ${members.length} members`);

  // ─────────────────────────────────────────────
  // 4. MEMBERSHIP PLANS
  // ─────────────────────────────────────────────
  await MembershipPlan.deleteMany({});
  await MembershipPlan.insertMany([
    { name: 'Monthly',    slug: 'monthly',     durationDays: 30,  price: 1500,  isPopular: false, features: ['Gym Access', 'Locker Room', 'Basic Fitness Assessment'] },
    { name: 'Quarterly',  slug: 'quarterly',   durationDays: 90,  price: 3500,  isPopular: false, features: ['Gym Access', 'Locker Room', 'Fitness Assessment', '1 Diet Consultation'] },
    { name: 'Half-Yearly',slug: 'half-yearly', durationDays: 180, price: 6000,  isPopular: true,  features: ['Gym Access', 'Locker Room', 'Fitness Assessment', '2 Diet Consultations', 'Personal Trainer (2/month)'] },
    { name: 'Yearly',     slug: 'yearly',      durationDays: 365, price: 10000, isPopular: false, features: ['Unlimited Gym Access', 'Locker Room', 'Fitness Assessment', 'Unlimited Diet Consultations', 'Personal Trainer (8/month)', 'Supplement Discount 10%'] },
  ]);
  console.log('✅ Seeded membership plans');

  // ─────────────────────────────────────────────
  // 5. EXERCISES
  // ─────────────────────────────────────────────
  await Exercise.deleteMany({});
  const exerciseData = [
    // Chest
    { title: 'Barbell Bench Press',    muscleGroup: 'chest',    difficulty: 'intermediate', description: 'Lie flat on a bench, grip barbell slightly wider than shoulder-width. Lower to chest and press up explosively.', sets: 4, reps: '8-10',   videoUrl: 'https://www.youtube.com/watch?v=rT7DgCr-3pg', isPublic: true },
    { title: 'Incline Dumbbell Press', muscleGroup: 'chest',    difficulty: 'intermediate', description: 'Set bench to 30-45°. Press dumbbells up from chest level, focusing on upper chest activation.', sets: 4, reps: '10-12',  isPublic: true },
    { title: 'Cable Chest Fly',        muscleGroup: 'chest',    difficulty: 'beginner',     description: 'Set cables at shoulder height, bring handles together in a hugging motion. Squeeze chest at peak.', sets: 3, reps: '12-15',  isPublic: true },
    { title: 'Push-Up',                muscleGroup: 'chest',    difficulty: 'beginner',     description: 'Classic bodyweight chest exercise. Keep core tight, lower chest to floor and push up.', sets: 3, reps: '15-20',  isPublic: true },
    { title: 'Dips',                   muscleGroup: 'chest',    difficulty: 'intermediate', description: 'Lean forward to target chest. Lower until shoulders are below elbows, then push up.', sets: 3, reps: '10-15',  isPublic: true },
    // Back
    { title: 'Deadlift',               muscleGroup: 'back',     difficulty: 'advanced',     description: 'Hip-hinge movement, maintain neutral spine. Drive through heels to lift the bar from floor to hip height.', sets: 4, reps: '5-6',    videoUrl: 'https://www.youtube.com/watch?v=op9kVnSso6Q', isPublic: true },
    { title: 'Pull-Up',                muscleGroup: 'back',     difficulty: 'intermediate', description: 'Overhand grip, pull chest to bar. Full dead hang at bottom for full lat stretch.', sets: 4, reps: '6-10',   isPublic: true },
    { title: 'Barbell Row',            muscleGroup: 'back',     difficulty: 'intermediate', description: 'Hinge at hips, pull barbell to lower chest. Squeeze shoulder blades together at top.', sets: 4, reps: '8-10',   isPublic: true },
    { title: 'Lat Pulldown',           muscleGroup: 'back',     difficulty: 'beginner',     description: 'Pull bar to upper chest, lean back slightly. Focus on driving elbows down to engage lats.', sets: 3, reps: '10-12',  isPublic: true },
    { title: 'Seated Cable Row',       muscleGroup: 'back',     difficulty: 'beginner',     description: 'Keep chest up, pull handle to lower abdomen. Hold 1 second at peak contraction.', sets: 3, reps: '12-15',  isPublic: true },
    // Shoulders
    { title: 'Overhead Press',         muscleGroup: 'shoulders',difficulty: 'intermediate', description: 'Standing or seated, press barbell from clavicle to overhead. Keep core braced throughout.', sets: 4, reps: '8-10',   isPublic: true },
    { title: 'Lateral Raise',          muscleGroup: 'shoulders',difficulty: 'beginner',     description: 'Raise dumbbells to shoulder height with slight bend in elbows. Lean forward slightly for better tension.', sets: 4, reps: '12-15',  isPublic: true },
    { title: 'Arnold Press',           muscleGroup: 'shoulders',difficulty: 'intermediate', description: 'Start with palms facing you. Rotate out as you press overhead for full shoulder activation.', sets: 3, reps: '10-12',  isPublic: true },
    { title: 'Face Pull',              muscleGroup: 'shoulders',difficulty: 'beginner',     description: 'Set cable at face height, pull to forehead with external rotation. Excellent for rear delts and rotator cuff.', sets: 3, reps: '15-20',  isPublic: true },
    { title: 'Front Raise',            muscleGroup: 'shoulders',difficulty: 'beginner',     description: 'Raise dumbbells or plate to shoulder height directly in front. Alternate arms or together.', sets: 3, reps: '12-15',  isPublic: true },
    // Arms
    { title: 'Barbell Bicep Curl',     muscleGroup: 'arms',     difficulty: 'beginner',     description: 'Stand with barbell, elbows fixed to sides. Curl up fully and lower slowly for maximum tension.', sets: 4, reps: '10-12',  isPublic: true },
    { title: 'Hammer Curl',            muscleGroup: 'arms',     difficulty: 'beginner',     description: 'Neutral grip dumbbell curl. Targets brachialis and brachioradialis along with biceps.', sets: 3, reps: '12-15',  isPublic: true },
    { title: 'Tricep Pushdown',        muscleGroup: 'arms',     difficulty: 'beginner',     description: 'Keep elbows at sides, push rope or bar down until arms fully extend. Squeeze triceps at bottom.', sets: 4, reps: '12-15',  isPublic: true },
    { title: 'Skull Crusher',          muscleGroup: 'arms',     difficulty: 'intermediate', description: 'Lie on bench, lower EZ-bar to forehead with elbows fixed. Extend arms fully, targeting tricep long head.', sets: 3, reps: '10-12',  isPublic: true },
    { title: 'Concentration Curl',     muscleGroup: 'arms',     difficulty: 'beginner',     description: 'Sit and brace elbow on inner thigh. Full range curl for peak bicep contraction.', sets: 3, reps: '12-15',  isPublic: true },
    // Legs
    { title: 'Barbell Squat',          muscleGroup: 'legs',     difficulty: 'advanced',     description: 'Bar on upper traps, squat until thighs parallel. Drive through heels, keep knees tracking toes.', sets: 4, reps: '6-8',    videoUrl: 'https://www.youtube.com/watch?v=ultWZbUMPL8', isPublic: true },
    { title: 'Romanian Deadlift',      muscleGroup: 'legs',     difficulty: 'intermediate', description: 'Hip hinge with slight knee bend. Lower barbell down legs feeling hamstring stretch, then drive hips forward.', sets: 4, reps: '10-12',  isPublic: true },
    { title: 'Leg Press',              muscleGroup: 'legs',     difficulty: 'beginner',     description: 'Push platform away with full foot contact. Do not lock knees at top. Control the descent.', sets: 4, reps: '12-15',  isPublic: true },
    { title: 'Lunges',                 muscleGroup: 'legs',     difficulty: 'beginner',     description: 'Step forward, lower back knee toward floor. Keep front shin vertical. Alternate legs each rep.', sets: 3, reps: '12 each', isPublic: true },
    { title: 'Leg Curl',               muscleGroup: 'legs',     difficulty: 'beginner',     description: 'Lying or seated, curl weight toward glutes. Full stretch at bottom for full hamstring activation.', sets: 3, reps: '12-15',  isPublic: true },
    // Core
    { title: 'Plank',                  muscleGroup: 'core',     difficulty: 'beginner',     description: 'Hold push-up position on forearms. Keep hips level with shoulders, brace like you\'re about to be punched.', sets: 3, reps: '30-60 sec', isPublic: true },
    { title: 'Cable Crunch',           muscleGroup: 'core',     difficulty: 'beginner',     description: 'Kneel at cable, pull rope attachment toward floor. Round lower back to maximise rectus abdominis contraction.', sets: 3, reps: '15-20',  isPublic: true },
    { title: 'Hanging Leg Raise',      muscleGroup: 'core',     difficulty: 'intermediate', description: 'Hang from bar, raise legs to 90° or higher. Control descent to avoid hip flexor dominance.', sets: 3, reps: '12-15',  isPublic: true },
    { title: 'Ab Wheel Rollout',       muscleGroup: 'core',     difficulty: 'advanced',     description: 'Roll wheel forward from kneeling, extend as far as possible. Brace hard and pull back with lats and abs.', sets: 3, reps: '8-12',   isPublic: true },
    { title: 'Russian Twist',          muscleGroup: 'core',     difficulty: 'beginner',     description: 'Seated with feet off floor, rotate torso side to side holding a plate or dumbbell.', sets: 3, reps: '20 total', isPublic: true },
    // Cardio
    { title: 'Treadmill HIIT',         muscleGroup: 'cardio',   difficulty: 'intermediate', description: '30 sec sprint at 90% max HR then 60 sec walk. Repeat 8-10 rounds for maximum fat burn.', sets: 8, reps: '30s on/60s off', isPublic: true },
    { title: 'Jump Rope',              muscleGroup: 'cardio',   difficulty: 'beginner',     description: 'Skip rope continuously for 60 second intervals. Great for coordination, calves, and cardiovascular endurance.', sets: 5, reps: '60 sec', isPublic: true },
    { title: 'Battle Ropes',           muscleGroup: 'cardio',   difficulty: 'intermediate', description: 'Alternate arm waves for 30 seconds, rest 30. Total body metabolic conditioning.', sets: 6, reps: '30 sec', isPublic: true },
    { title: 'Box Jump',               muscleGroup: 'cardio',   difficulty: 'intermediate', description: 'Explosive jump onto plyo box. Land softly, step down, reset. Focus on explosive power output.', sets: 4, reps: '8-10',   isPublic: true },
    { title: 'Rowing Machine',         muscleGroup: 'cardio',   difficulty: 'beginner',     description: 'Set damper to 4-6. Drive with legs first, then lean back, then pull. Reverse order on return stroke.', sets: 1, reps: '10-20 min', isPublic: true },
    // Full Body
    { title: 'Clean and Press',        muscleGroup: 'full-body', difficulty: 'advanced',     description: 'Power clean barbell to shoulders, then overhead press. Full-body explosive compound movement.', sets: 4, reps: '5-6',   isPublic: true },
    { title: 'Burpee',                 muscleGroup: 'full-body', difficulty: 'intermediate', description: 'Drop to push-up, perform push-up, jump feet to hands, then explode upward into a jump.', sets: 4, reps: '10-15',  isPublic: true },
    { title: 'Kettlebell Swing',       muscleGroup: 'full-body', difficulty: 'beginner',     description: 'Hip hinge, swing kettlebell between legs then drive hips forward. The bell floats to shoulder height.', sets: 4, reps: '15-20',  isPublic: true },
    { title: 'Thrusters',              muscleGroup: 'full-body', difficulty: 'intermediate', description: 'Front squat to overhead press in one fluid motion. Brutal metabolic and strength movement.', sets: 4, reps: '8-10',   isPublic: true },
    { title: 'Turkish Get-Up',         muscleGroup: 'full-body', difficulty: 'advanced',     description: 'From lying with one arm extended holding weight, stand up while keeping weight overhead. Reverse to return.', sets: 3, reps: '3-5 each', isPublic: true },
  ];
  const exercises = await Exercise.insertMany(exerciseData.map(e => ({ ...e, createdBy: admin._id, uploadedBy: admin._id })));
  console.log(`✅ Seeded ${exercises.length} exercises`);

  // Helper: find exercise _id by title
  const ex = (title) => exercises.find(e => e.title === title)?._id;

  // ─────────────────────────────────────────────
  // 6. WORKOUT SPLITS
  // ─────────────────────────────────────────────
  await WorkoutSplit.deleteMany({});
  await WorkoutSplit.insertMany([
    {
      title: 'Push Pull Legs (PPL)',
      createdBy: admin._id,
      goal: 'muscle',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Push – Chest & Triceps',  exercises: [ex('Barbell Bench Press'), ex('Incline Dumbbell Press'), ex('Cable Chest Fly'), ex('Tricep Pushdown'), ex('Skull Crusher')], notes: 'Rest 90s between sets' },
        { day: 'Tuesday',   focus: 'Pull – Back & Biceps',    exercises: [ex('Deadlift'), ex('Pull-Up'), ex('Barbell Row'), ex('Lat Pulldown'), ex('Barbell Bicep Curl'), ex('Hammer Curl')], notes: 'Focus on mind-muscle connection' },
        { day: 'Wednesday', focus: 'Legs',                    exercises: [ex('Barbell Squat'), ex('Romanian Deadlift'), ex('Leg Press'), ex('Lunges'), ex('Leg Curl')], notes: 'Stretch thoroughly after' },
        { day: 'Thursday',  focus: 'Push – Shoulders',        exercises: [ex('Overhead Press'), ex('Arnold Press'), ex('Lateral Raise'), ex('Front Raise'), ex('Face Pull')], notes: 'Use lighter weight for isolation' },
        { day: 'Friday',    focus: 'Pull – Back & Biceps',    exercises: [ex('Pull-Up'), ex('Seated Cable Row'), ex('Lat Pulldown'), ex('Concentration Curl'), ex('Hammer Curl')], notes: '' },
        { day: 'Saturday',  focus: 'Legs + Core',             exercises: [ex('Barbell Squat'), ex('Leg Press'), ex('Lunges'), ex('Plank'), ex('Hanging Leg Raise'), ex('Russian Twist')], notes: '' },
        { day: 'Sunday',    focus: 'Rest / Active Recovery',  exercises: [], notes: 'Light walk or stretching only' },
      ]
    },
    {
      title: 'Full Body Strength',
      createdBy: admin._id,
      goal: 'strength',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Full Body A',  exercises: [ex('Barbell Squat'), ex('Barbell Bench Press'), ex('Barbell Row'), ex('Overhead Press'), ex('Plank')], notes: '5x5 scheme, heavy weight' },
        { day: 'Tuesday',   focus: 'Rest',         exercises: [], notes: 'Full rest or light cardio' },
        { day: 'Wednesday', focus: 'Full Body B',  exercises: [ex('Deadlift'), ex('Pull-Up'), ex('Dips'), ex('Romanian Deadlift'), ex('Cable Crunch')], notes: '' },
        { day: 'Thursday',  focus: 'Rest',         exercises: [], notes: 'Full rest or light cardio' },
        { day: 'Friday',    focus: 'Full Body C',  exercises: [ex('Barbell Squat'), ex('Incline Dumbbell Press'), ex('Seated Cable Row'), ex('Lunges'), ex('Ab Wheel Rollout')], notes: '' },
        { day: 'Saturday',  focus: 'Cardio',       exercises: [ex('Treadmill HIIT'), ex('Jump Rope'), ex('Battle Ropes')], notes: '20-30 minutes' },
        { day: 'Sunday',    focus: 'Rest',         exercises: [], notes: '' },
      ]
    },
    {
      title: 'Fat Loss Circuit',
      createdBy: admin._id,
      goal: 'fat_loss',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Upper Body Circuit',  exercises: [ex('Push-Up'), ex('Pull-Up'), ex('Dips'), ex('Barbell Row'), ex('Overhead Press'), ex('Battle Ropes')], notes: 'Minimal rest between exercises' },
        { day: 'Tuesday',   focus: 'HIIT Cardio',         exercises: [ex('Treadmill HIIT'), ex('Jump Rope'), ex('Box Jump'), ex('Burpee')], notes: '30 min session' },
        { day: 'Wednesday', focus: 'Lower Body Circuit',  exercises: [ex('Barbell Squat'), ex('Lunges'), ex('Leg Press'), ex('Leg Curl'), ex('Box Jump')], notes: '' },
        { day: 'Thursday',  focus: 'Core + Cardio',       exercises: [ex('Plank'), ex('Russian Twist'), ex('Hanging Leg Raise'), ex('Rowing Machine'), ex('Jump Rope')], notes: '' },
        { day: 'Friday',    focus: 'Full Body MetCon',    exercises: [ex('Kettlebell Swing'), ex('Thrusters'), ex('Burpee'), ex('Battle Ropes'), ex('Box Jump')], notes: '4 rounds, minimal rest' },
        { day: 'Saturday',  focus: 'Steady State Cardio', exercises: [ex('Rowing Machine'), ex('Treadmill HIIT')], notes: '40 min moderate pace' },
        { day: 'Sunday',    focus: 'Rest',                exercises: [], notes: '' },
      ]
    },
    {
      title: 'Beginner Starter Plan',
      createdBy: trainers[0]._id,
      goal: 'general',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Chest & Shoulders',  exercises: [ex('Push-Up'), ex('Cable Chest Fly'), ex('Lateral Raise'), ex('Front Raise')], notes: 'Focus on form, not weight' },
        { day: 'Tuesday',   focus: 'Back & Biceps',      exercises: [ex('Lat Pulldown'), ex('Seated Cable Row'), ex('Barbell Bicep Curl'), ex('Hammer Curl')], notes: '' },
        { day: 'Wednesday', focus: 'Legs',               exercises: [ex('Leg Press'), ex('Lunges'), ex('Leg Curl'), ex('Romanian Deadlift')], notes: '' },
        { day: 'Thursday',  focus: 'Core & Cardio',      exercises: [ex('Plank'), ex('Russian Twist'), ex('Cable Crunch'), ex('Jump Rope')], notes: '' },
        { day: 'Friday',    focus: 'Arms',               exercises: [ex('Barbell Bicep Curl'), ex('Hammer Curl'), ex('Tricep Pushdown'), ex('Skull Crusher'), ex('Concentration Curl')], notes: '' },
        { day: 'Saturday',  focus: 'Light Cardio',       exercises: [ex('Jump Rope'), ex('Rowing Machine')], notes: '20-30 minutes easy pace' },
        { day: 'Sunday',    focus: 'Rest',               exercises: [], notes: '' },
      ]
    },
  ]);
  console.log('✅ Seeded workout splits');

  // ─────────────────────────────────────────────
  // 7. PRODUCTS (Store)
  // ─────────────────────────────────────────────
  await Product.deleteMany({});
  await Product.insertMany([
    {
      name: 'Optimum Nutrition Gold Standard Whey', category: 'protein', brand: 'Optimum Nutrition',
      description: '24g of protein per serving with whey isolates as the primary protein source. Low sugar, low fat. The world\'s best-selling whey protein.',
      price: 4500, discountPrice: 3999, stock: 50,
      flavors: ['Chocolate', 'Vanilla', 'Strawberry', 'Double Rich Chocolate'],
      weights: ['1kg', '2kg', '5lb'],
      rating: 4.8, reviewCount: 245, isFeatured: true,
      images: ['https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=400'],
    },
    {
      name: 'MuscleBlaze Raw Whey Protein', category: 'protein', brand: 'MuscleBlaze',
      description: 'Unflavoured raw whey protein isolate. 25g protein per serving, ideal for adding to smoothies, oats, or any recipe.',
      price: 2800, discountPrice: 2399, stock: 75,
      flavors: ['Unflavoured'],
      weights: ['1kg', '2kg'],
      rating: 4.5, reviewCount: 182,
      images: ['https://images.unsplash.com/photo-1559181567-c3190ca9d222?w=400'],
    },
    {
      name: 'Dymatize ISO 100 Hydrolyzed', category: 'protein', brand: 'Dymatize',
      description: 'Hydrolyzed whey protein isolate for maximum absorption. 25g protein, <1g sugar, fast-digesting for post-workout recovery.',
      price: 5200, discountPrice: 4599, stock: 30,
      flavors: ['Gourmet Vanilla', 'Chocolate Peanut Butter', 'Fruity Pebbles'],
      weights: ['1.4kg', '2.3kg'],
      rating: 4.7, reviewCount: 120, isFeatured: true,
      images: ['https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400'],
    },
    {
      name: 'Creatine Monohydrate', category: 'creatine', brand: 'Muscletech',
      description: 'Pure micronized creatine monohydrate. 5g per serving to increase strength, power, and muscle gains. Mixes instantly.',
      price: 1200, discountPrice: 999, stock: 100,
      flavors: ['Unflavoured'],
      weights: ['300g', '500g'],
      rating: 4.6, reviewCount: 310, isFeatured: false,
      images: ['https://images.unsplash.com/photo-1612538498456-e861df91d4d0?w=400'],
    },
    {
      name: 'Transparent Labs BULK Pre-Workout', category: 'pre-workout', brand: 'Transparent Labs',
      description: 'Clinically dosed pre-workout with 8g citrulline malate, 4g beta-alanine, 300mg caffeine. No proprietary blends.',
      price: 3200, discountPrice: 2799, stock: 40,
      flavors: ['Blue Raspberry', 'Strawberry Kiwi', 'Black Cherry'],
      weights: ['40 servings'],
      rating: 4.7, reviewCount: 95,
      images: ['https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400'],
    },
    {
      name: 'C4 Original Pre-Workout', category: 'pre-workout', brand: 'Cellucor',
      description: 'America\'s #1 pre-workout. 150mg caffeine, CarnoSyn Beta-Alanine, and creatine nitrate for explosive energy and pumps.',
      price: 2200, discountPrice: 1899, stock: 60,
      flavors: ['Fruit Punch', 'Watermelon', 'Pink Lemonade', 'Orange'],
      weights: ['30 servings', '60 servings'],
      rating: 4.4, reviewCount: 430, isFeatured: true,
      images: ['https://images.unsplash.com/photo-1546519638-68e109498ffc?w=400'],
    },
    {
      name: 'Optimum Nutrition BCAA 1000', category: 'bcaa', brand: 'Optimum Nutrition',
      description: '5g BCAAs per serving with a 2:1:1 ratio of leucine, isoleucine, and valine. Supports muscle recovery and reduces fatigue.',
      price: 1800, discountPrice: 1499, stock: 80,
      flavors: ['Unflavoured', 'Fruit Punch'],
      weights: ['200 caps', '400 caps'],
      rating: 4.5, reviewCount: 178,
      images: ['https://images.unsplash.com/photo-1550572017-9b4b5e8c0b3c?w=400'],
    },
    {
      name: 'Serious Mass Weight Gainer', category: 'weight-gainer', brand: 'Optimum Nutrition',
      description: '1250 calories per serving with 50g protein, 250g carbohydrates. Ideal for hard gainers who struggle to put on size.',
      price: 3800, discountPrice: 3299, stock: 35,
      flavors: ['Chocolate', 'Vanilla', 'Banana'],
      weights: ['2.7kg', '5.4kg'],
      rating: 4.3, reviewCount: 220,
      images: ['https://images.unsplash.com/photo-1531545514256-b1400bc00f31?w=400'],
    },
    {
      name: 'Multivitamin Sport', category: 'vitamins', brand: 'HealthKart',
      description: '25+ vitamins and minerals formulated for active individuals. Includes Vitamin D3, B-complex, Zinc, and Magnesium.',
      price: 800, discountPrice: 649, stock: 120,
      flavors: [],
      weights: ['60 tabs', '120 tabs'],
      rating: 4.4, reviewCount: 88,
      images: ['https://images.unsplash.com/photo-1607619056574-7b8d3ee536b2?w=400'],
    },
    {
      name: 'Omega 3 Fish Oil', category: 'vitamins', brand: 'Now Foods',
      description: '1000mg fish oil per softgel with EPA and DHA. Supports heart health, joint health, and reduces inflammation.',
      price: 600, discountPrice: 499, stock: 150,
      flavors: [],
      weights: ['90 softgels', '180 softgels'],
      rating: 4.6, reviewCount: 134,
      images: ['https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400'],
    },
    {
      name: 'Lipo-6 Black Fat Burner', category: 'fat-burner', brand: 'Nutrex Research',
      description: 'Powerful thermogenic fat burner. Increases metabolism, suppresses appetite, and boosts energy for intense workouts.',
      price: 2100, discountPrice: 1799, stock: 45,
      flavors: [],
      weights: ['60 caps', '120 caps'],
      rating: 4.2, reviewCount: 67,
      images: ['https://images.unsplash.com/photo-1582719188393-bb71ca45dbb9?w=400'],
    },
    {
      name: 'FitNation Gym Gloves', category: 'accessories', brand: 'FitNation',
      description: 'Premium leather grip gloves with wrist wrap support. Anti-slip palm padding for heavy lifts. Available in all sizes.',
      price: 650, discountPrice: 499, stock: 90,
      flavors: [],
      weights: ['S', 'M', 'L', 'XL'],
      rating: 4.5, reviewCount: 56, isFeatured: false,
      images: ['https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400'],
    },
    {
      name: 'Shaker Bottle 700ml', category: 'accessories', brand: 'BlenderBottle',
      description: 'BPA-free 700ml shaker bottle with BlenderBall wire whisk. Leakproof and dishwasher safe.',
      price: 350, discountPrice: 299, stock: 200,
      flavors: ['Black', 'Blue', 'Red', 'White'],
      weights: ['700ml'],
      rating: 4.7, reviewCount: 312,
      images: ['https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400'],
    },
    {
      name: 'FitNation Compression T-Shirt', category: 'apparel', brand: 'FitNation',
      description: 'Moisture-wicking compression fit training t-shirt. 4-way stretch fabric keeps you cool during intense workouts.',
      price: 999, discountPrice: 799, stock: 70,
      flavors: ['Black', 'Navy', 'Grey', 'White'],
      weights: ['S', 'M', 'L', 'XL', 'XXL'],
      rating: 4.3, reviewCount: 45,
      images: ['https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400'],
    },
    {
      name: 'Resistance Band Set', category: 'accessories', brand: 'FitNation',
      description: 'Set of 5 resistance bands with varying tensions (10-50 lbs). Perfect for warm-ups, mobility work, and home workouts.',
      price: 799, discountPrice: 599, stock: 65,
      flavors: [],
      weights: ['Set of 5'],
      rating: 4.6, reviewCount: 89, isFeatured: true,
      images: ['https://images.unsplash.com/photo-1598632640487-6ea4a4e8b963?w=400'],
    },
  ]);
  console.log('✅ Seeded products');

  // ─────────────────────────────────────────────
  // 8. DIET PLANS
  // ─────────────────────────────────────────────
  await DietPlan.deleteMany({});
  await DietPlan.insertMany([
    {
      title: 'Muscle Gain Diet Plan',
      description: 'High-calorie, high-protein diet designed for muscle hypertrophy. Includes 6 meals with balanced macros.',
      goal: 'muscle-gain',
      totalCalories: 3200,
      totalProtein: '180g',
      isPublic: true,
      uploadedBy: admin._id,
      assignedTo: [members[0]._id, members[2]._id],
      meals: [
        { mealType: 'breakfast',     time: '7:00 AM',  items: [{ name: 'Oats', quantity: '100g', calories: 370, protein: '13g', carbs: '67g', fat: '7g' }, { name: 'Whole Eggs', quantity: '4 eggs', calories: 280, protein: '24g', carbs: '2g', fat: '20g' }, { name: 'Milk', quantity: '300ml', calories: 180, protein: '10g', carbs: '14g', fat: '8g' }], notes: 'Add banana if still hungry' },
        { mealType: 'pre-workout',   time: '10:00 AM', items: [{ name: 'Banana', quantity: '2 medium', calories: 210, protein: '2g', carbs: '54g', fat: '0g' }, { name: 'Peanut Butter', quantity: '2 tbsp', calories: 190, protein: '8g', carbs: '6g', fat: '16g' }], notes: '30 mins before workout' },
        { mealType: 'post-workout',  time: '1:00 PM',  items: [{ name: 'Whey Protein', quantity: '1 scoop (30g)', calories: 120, protein: '24g', carbs: '3g', fat: '1g' }, { name: 'Rice', quantity: '200g cooked', calories: 260, protein: '5g', carbs: '57g', fat: '0g' }], notes: 'Within 30 mins of workout' },
        { mealType: 'lunch',         time: '2:30 PM',  items: [{ name: 'Chicken Breast', quantity: '200g', calories: 330, protein: '62g', carbs: '0g', fat: '7g' }, { name: 'Brown Rice', quantity: '200g cooked', calories: 220, protein: '5g', carbs: '46g', fat: '2g' }, { name: 'Salad', quantity: '1 bowl', calories: 50, protein: '2g', carbs: '10g', fat: '0g' }], notes: 'Add olive oil dressing' },
        { mealType: 'snack',         time: '5:30 PM',  items: [{ name: 'Greek Yogurt', quantity: '200g', calories: 130, protein: '17g', carbs: '9g', fat: '0g' }, { name: 'Mixed Nuts', quantity: '30g', calories: 170, protein: '5g', carbs: '6g', fat: '15g' }] },
        { mealType: 'dinner',        time: '8:30 PM',  items: [{ name: 'Paneer / Tofu', quantity: '150g', calories: 270, protein: '21g', carbs: '4g', fat: '18g' }, { name: 'Roti', quantity: '3 rotis', calories: 240, protein: '8g', carbs: '48g', fat: '3g' }, { name: 'Dal', quantity: '1 bowl', calories: 150, protein: '10g', carbs: '25g', fat: '2g' }], notes: 'Casein protein shake before sleep optionally' },
      ]
    },
    {
      title: 'Fat Loss Diet Plan',
      description: 'Calorie-deficit high-protein diet to preserve muscle while losing fat. 5 meals, low carb cycling on rest days.',
      goal: 'weight-loss',
      totalCalories: 1800,
      totalProtein: '160g',
      isPublic: true,
      uploadedBy: admin._id,
      assignedTo: [members[5]._id, members[4]._id],
      meals: [
        { mealType: 'breakfast',    time: '7:30 AM', items: [{ name: 'Egg Whites', quantity: '6 whites', calories: 102, protein: '21g', carbs: '1g', fat: '0g' }, { name: 'Spinach Omelette', quantity: '1 bowl spinach', calories: 30, protein: '3g', carbs: '5g', fat: '0g' }, { name: 'Green Tea', quantity: '1 cup', calories: 5, protein: '0g', carbs: '1g', fat: '0g' }], notes: 'No oil, cook in non-stick pan' },
        { mealType: 'snack',        time: '10:30 AM',items: [{ name: 'Apple', quantity: '1 medium', calories: 95, protein: '0g', carbs: '25g', fat: '0g' }, { name: 'Almonds', quantity: '15 pieces', calories: 104, protein: '4g', carbs: '4g', fat: '9g' }] },
        { mealType: 'lunch',        time: '1:30 PM', items: [{ name: 'Grilled Chicken', quantity: '150g', calories: 247, protein: '46g', carbs: '0g', fat: '5g' }, { name: 'Quinoa', quantity: '150g cooked', calories: 180, protein: '7g', carbs: '32g', fat: '3g' }, { name: 'Cucumber Salad', quantity: '1 bowl', calories: 30, protein: '1g', carbs: '7g', fat: '0g' }] },
        { mealType: 'pre-workout',  time: '4:30 PM', items: [{ name: 'Banana', quantity: '1 small', calories: 90, protein: '1g', carbs: '23g', fat: '0g' }, { name: 'Black Coffee', quantity: '1 cup', calories: 5, protein: '0g', carbs: '0g', fat: '0g' }] },
        { mealType: 'dinner',       time: '8:00 PM', items: [{ name: 'Tuna / Fish', quantity: '150g', calories: 195, protein: '38g', carbs: '0g', fat: '4g' }, { name: 'Steamed Vegetables', quantity: '1 large bowl', calories: 80, protein: '4g', carbs: '16g', fat: '1g' }], notes: 'Avoid carbs after 7 PM' },
      ]
    },
    {
      title: 'Vegetarian Balanced Plan',
      description: 'Complete vegetarian meal plan with adequate protein from plant sources. Suitable for all fitness goals.',
      goal: 'maintenance',
      totalCalories: 2200,
      totalProtein: '120g',
      isPublic: true,
      uploadedBy: trainers[1]._id,
      meals: [
        { mealType: 'breakfast',   time: '7:00 AM', items: [{ name: 'Moong Dal Chilla', quantity: '3 pieces', calories: 240, protein: '15g', carbs: '38g', fat: '4g' }, { name: 'Curd', quantity: '150g', calories: 90, protein: '8g', carbs: '7g', fat: '3g' }] },
        { mealType: 'snack',       time: '10:30 AM',items: [{ name: 'Sprouts Salad', quantity: '1 bowl', calories: 120, protein: '9g', carbs: '22g', fat: '1g' }, { name: 'Lemon Water', quantity: '1 glass', calories: 10, protein: '0g', carbs: '3g', fat: '0g' }] },
        { mealType: 'lunch',       time: '1:00 PM', items: [{ name: 'Paneer Bhurji', quantity: '150g paneer', calories: 270, protein: '18g', carbs: '6g', fat: '20g' }, { name: 'Roti', quantity: '3 rotis', calories: 240, protein: '8g', carbs: '48g', fat: '3g' }, { name: 'Dal Tadka', quantity: '1 bowl', calories: 160, protein: '10g', carbs: '25g', fat: '4g' }] },
        { mealType: 'snack',       time: '5:00 PM', items: [{ name: 'Peanut Butter Toast', quantity: '2 slices', calories: 310, protein: '12g', carbs: '36g', fat: '14g' }] },
        { mealType: 'dinner',      time: '8:30 PM', items: [{ name: 'Tofu Stir Fry', quantity: '200g tofu', calories: 200, protein: '20g', carbs: '8g', fat: '11g' }, { name: 'Brown Rice', quantity: '150g cooked', calories: 165, protein: '4g', carbs: '35g', fat: '1g' }] },
      ]
    },
  ]);
  console.log('✅ Seeded diet plans');

  // ─────────────────────────────────────────────
  // 9. TRANSFORMATIONS
  // ─────────────────────────────────────────────
  await Transformation.deleteMany({});
  await Transformation.insertMany([
    { member: members[0]._id, title: 'Aman\'s 3-Month Bulk', description: 'Gained 8kg of lean muscle mass in 3 months following the PPL split and muscle gain diet.', beforeImage: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400', afterImage: 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400', duration: '3 months', weightLost: '', muscleGained: '8kg lean mass', isPublic: true, uploadedBy: admin._id },
    { member: members[1]._id, title: 'Sneha\'s Weight Loss Journey', description: 'Lost 12kg in 4 months through consistent training and fat loss diet. Incredible transformation!', beforeImage: 'https://images.unsplash.com/photo-1518310383802-640c2de311b6?w=400', afterImage: 'https://images.unsplash.com/photo-1616279969600-7f4e4e7c1b9e?w=400', duration: '4 months', weightLost: '12kg', muscleGained: '', isPublic: true, uploadedBy: admin._id },
    { member: members[2]._id, title: 'Rohit\'s Strength Transformation', description: 'Bench press went from 60kg to 100kg in 6 months. Complete body recomposition.', beforeImage: 'https://images.unsplash.com/photo-1540474252-71ebe7aed77b?w=400', afterImage: 'https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=400', duration: '6 months', weightLost: '5kg fat', muscleGained: '10kg lean mass', isPublic: true, uploadedBy: trainers[0]._id },
    { member: members[3]._id, title: 'Neha\'s Fitness Journey', description: 'From sedentary lifestyle to completing her first 5k run and losing 8kg in the process.', beforeImage: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=400', afterImage: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=400', duration: '5 months', weightLost: '8kg', muscleGained: '2kg lean mass', isPublic: true, uploadedBy: trainers[1]._id },
    { member: members[6]._id, title: 'Sanjay\'s 90-Day Challenge', description: 'Followed the full body strength plan religiously for 90 days. Completely unrecognisable!', beforeImage: 'https://images.unsplash.com/photo-1571731956672-f2b94d7dd0cb?w=400', afterImage: 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400', duration: '3 months', weightLost: '7kg', muscleGained: '5kg lean mass', isPublic: true, uploadedBy: admin._id },
  ]);
  console.log('✅ Seeded transformations');

  // ─────────────────────────────────────────────
  // 10. PROGRESS ENTRIES
  // ─────────────────────────────────────────────
  await ProgressEntry.deleteMany({});
  const progressData = [];
  const baseStats = [
    { member: members[0]._id, weight: 78, bodyFat: 18, chest: 98, waist: 84, hips: 96, arms: 35, thighs: 58 },
    { member: members[1]._id, weight: 68, bodyFat: 25, chest: 90, waist: 78, hips: 100, arms: 28, thighs: 62 },
    { member: members[2]._id, weight: 85, bodyFat: 20, chest: 102, waist: 88, hips: 98, arms: 38, thighs: 60 },
    { member: members[3]._id, weight: 62, bodyFat: 22, chest: 86, waist: 72, hips: 94, arms: 26, thighs: 58 },
  ];
  baseStats.forEach(({ member, weight, bodyFat, chest, waist, hips, arms, thighs }) => {
    for (let i = 4; i >= 0; i--) {
      const delta = (4 - i) * 0.5;
      progressData.push({
        member, date: past(i * 30),
        weight: +(weight - delta * 0.8).toFixed(1),
        bodyFat: +(bodyFat - delta * 0.4).toFixed(1),
        chest:  +(chest  + delta * 0.3).toFixed(1),
        waist:  +(waist  - delta * 0.5).toFixed(1),
        hips:   +(hips   - delta * 0.2).toFixed(1),
        arms:   +(arms   + delta * 0.2).toFixed(1),
        thighs: +(thighs - delta * 0.1).toFixed(1),
        notes: i === 0 ? 'Great progress this month!' : '',
      });
    }
  });
  await ProgressEntry.insertMany(progressData);
  console.log(`✅ Seeded ${progressData.length} progress entries`);

  // ─────────────────────────────────────────────
  // 11. NOTIFICATIONS
  // ─────────────────────────────────────────────
  await Notification.deleteMany({});
  await Notification.insertMany([
    { member: members[0]._id, type: 'general',         title: 'Welcome to FitNation!',       message: 'Welcome Aman! Your membership is now active. Visit the gym anytime between 6AM-10PM.',   isRead: true,  sentVia: ['website'] },
    { member: members[1]._id, type: 'diet-assigned',   title: 'New Diet Plan Assigned',       message: 'Coach Priya has assigned you the Fat Loss Diet Plan. Check it out in your dashboard!',  isRead: false, sentVia: ['website', 'whatsapp'] },
    { member: members[2]._id, type: 'general',         title: 'Workout Split Updated',        message: 'Your Push Pull Legs split has been updated by your trainer Rahul. Check the new schedule.', isRead: false, sentVia: ['website'] },
    { member: members[4]._id, type: 'fee-reminder',    title: 'Fee Payment Due in 3 Days',    message: 'Hi Vikas, your membership fee of ₹1500 is due in 3 days. Please pay to avoid disruption.', isRead: false, sentVia: ['website', 'whatsapp'] },
    { member: members[5]._id, type: 'membership-expired', title: 'Membership Expired',        message: 'Hi Divya, your membership expired 10 days ago. Please renew to continue accessing the gym.', isRead: false, sentVia: ['website', 'whatsapp'] },
    { member: members[6]._id, type: 'exercise-assigned', title: 'New Workout Assigned',       message: 'Trainer Rahul has assigned you the Full Body Strength plan. Check your workout dashboard.',  isRead: true,  sentVia: ['website'] },
    { member: members[7]._id, type: 'general',         title: 'Gym Closed on 15th August',   message: 'Please note the gym will be closed on 15th August for Independence Day. Regular hours resume on 16th.', isRead: false, sentVia: ['website'] },
    { member: members[8]._id, type: 'diet-assigned',   title: 'Muscle Gain Plan Assigned',    message: 'Your new Muscle Gain Diet Plan is ready. Follow it consistently for best results!',      isRead: true,  sentVia: ['website'] },
    { member: members[3]._id, type: 'fee-reminder',    title: 'Membership Renewal Reminder',  message: 'Your membership renews in 7 days. Please ensure your payment is up to date.',            isRead: true,  sentVia: ['website', 'whatsapp'] },
    { member: members[9]._id, type: 'general',         title: 'New Supplements in Store',     message: 'Check out our latest stock including Dymatize ISO 100 and C4 Pre-Workout at special prices!', isRead: false, sentVia: ['website'] },
  ]);
  console.log('✅ Seeded notifications');

  // ─────────────────────────────────────────────
  // 12. ORDERS
  // ─────────────────────────────────────────────
  await Order.deleteMany({});
  const products = await Product.find({});
  const prod = (name) => products.find(p => p.name.includes(name));
  await Order.insertMany([
    {
      user: members[0]._id,
      items: [{ product: prod('Gold Standard')._id, name: prod('Gold Standard').name, price: 3999, quantity: 1, flavor: 'Chocolate', weight: '2kg', image: prod('Gold Standard').images[0] }],
      shippingAddress: { name: 'Aman Gupta', phone: '9111111111', address: '12 Saket Nagar', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
      totalAmount: 3999, paymentMethod: 'online', paymentStatus: 'paid', orderStatus: 'delivered',
    },
    {
      user: members[1]._id,
      items: [
        { product: prod('C4 Original')._id, name: prod('C4 Original').name, price: 1899, quantity: 1, flavor: 'Fruit Punch', weight: '30 servings', image: prod('C4 Original').images[0] },
        { product: prod('Shaker')._id,       name: prod('Shaker').name,       price: 299,  quantity: 1, flavor: 'Black',      weight: '700ml',      image: prod('Shaker').images[0] },
      ],
      shippingAddress: { name: 'Sneha Patil', phone: '9111111112', address: '45 Andheri West', city: 'Mumbai', state: 'Maharashtra', pincode: '400058' },
      totalAmount: 2198, paymentMethod: 'upi', paymentStatus: 'paid', orderStatus: 'shipped',
    },
    {
      user: members[2]._id,
      items: [{ product: prod('Creatine')._id, name: prod('Creatine').name, price: 999, quantity: 2, flavor: 'Unflavoured', weight: '300g', image: prod('Creatine').images[0] }],
      shippingAddress: { name: 'Rohit Joshi', phone: '9111111113', address: '78 Bandra', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' },
      totalAmount: 1998, paymentMethod: 'cod', paymentStatus: 'pending', orderStatus: 'confirmed',
    },
    {
      user: members[3]._id,
      items: [
        { product: prod('Omega')._id,        name: prod('Omega').name,        price: 499,  quantity: 1, flavor: '',      weight: '90 softgels', image: prod('Omega').images[0] },
        { product: prod('Multivitamin')._id, name: prod('Multivitamin').name, price: 649,  quantity: 1, flavor: '',      weight: '60 tabs',     image: prod('Multivitamin').images[0] },
      ],
      shippingAddress: { name: 'Neha Singh', phone: '9111111114', address: '23 Powai', city: 'Mumbai', state: 'Maharashtra', pincode: '400076' },
      totalAmount: 1148, paymentMethod: 'online', paymentStatus: 'paid', orderStatus: 'placed',
    },
    {
      user: members[6]._id,
      items: [{ product: prod('Resistance')._id, name: prod('Resistance').name, price: 599, quantity: 1, weight: 'Set of 5', image: prod('Resistance').images[0] }],
      shippingAddress: { name: 'Sanjay Patel', phone: '9111111117', address: '55 Malad', city: 'Mumbai', state: 'Maharashtra', pincode: '400064' },
      totalAmount: 599, paymentMethod: 'cod', paymentStatus: 'pending', orderStatus: 'placed',
    },
  ]);
  console.log('✅ Seeded orders');

  // ─────────────────────────────────────────────
  // 13. ENQUIRIES
  // ─────────────────────────────────────────────
  await Enquiry.deleteMany({});
  await Enquiry.insertMany([
    { name: 'Rahul Kapoor',   phone: '9800000001', email: 'rahul.k@gmail.com',   message: 'Interested in joining. What are the monthly fees and timings?',                interest: 'membership',         status: 'new' },
    { name: 'Prachi Desai',   phone: '9800000002', email: 'prachi.d@gmail.com',   message: 'Looking for a personal trainer for weight loss. What packages do you offer?', interest: 'personal-training',  status: 'contacted', notes: 'Called back, interested in 3-month package' },
    { name: 'Akash Mehta',    phone: '9800000003', email: 'akash.m@gmail.com',    message: 'Need a customised diet plan for bulking. Can you help?',                       interest: 'diet-plan',          status: 'converted', notes: 'Converted - joined yearly plan' },
    { name: 'Simran Kaur',    phone: '9800000004', email: 'simran.k@gmail.com',   message: 'Do you have any ongoing offers on supplements? Looking for protein powder.',   interest: 'supplements',        status: 'new' },
    { name: 'Raj Malhotra',   phone: '9800000005', email: 'raj.m@gmail.com',      message: 'What are the gym timings? Is there parking available near the gym?',            interest: 'general',            status: 'contacted' },
    { name: 'Kavya Reddy',    phone: '9800000006', email: 'kavya.r@gmail.com',    message: 'I am a beginner. Do you have programs for complete beginners with no experience?', interest: 'membership',      status: 'new' },
    { name: 'Nikhil Sharma',  phone: '9800000007', email: 'nikhil.s@gmail.com',   message: 'Looking for couples membership package. Do you offer that?',                   interest: 'membership',         status: 'closed',    notes: 'Not interested after learning the price' },
    { name: 'Tanya Gupta',    phone: '9800000008', email: 'tanya.g@gmail.com',    message: 'Wanted to inquire about your women-only training slots if available.',          interest: 'personal-training',  status: 'new' },
  ]);
  console.log('✅ Seeded enquiries');

  console.log('\n🎉 All seed data inserted successfully!');
  console.log('─────────────────────────────────────');
  console.log('Admin   → admin@fitnation.com  / admin123');
  console.log('Trainer → rahul@fitnation.com  / trainer123');
  console.log('Member  → aman@gmail.com       / member123');
  console.log('─────────────────────────────────────');
  process.exit(0);
};

seed().catch(err => { console.error(err); process.exit(1); });
