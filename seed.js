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
const Payment        = require('./models/Payment');
const ProgressEntry  = require('./models/ProgressEntry');
const Enquiry        = require('./models/Enquiry');

const U = (id, w = 800) => `https://images.unsplash.com/${id}?w=${w}&q=75&auto=format&fit=crop`;
const yt = (id) => `https://www.youtube.com/watch?v=${id}`;

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB: ${mongoose.connection.name}`);

  // ─────────────────────────────────────────────
  // 1. ADMIN USER (PRESERVE EXISTING)
  // ─────────────────────────────────────────────
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    admin = await User.create({
      name: 'Ajeet Jamadari',
      email: 'admin@fitnation.com',
      phone: '9630906906',
      password: await bcrypt.hash('admin123', 10),
      role: 'admin',
      isActive: true,
      address: 'Rajgarh'
    });
    console.log('✅ Admin created: admin@fitnation.com / admin123');
  } else {
    console.log(`✅ Admin preserved: ${admin.name} <${admin.email}>`);
  }

  // ─────────────────────────────────────────────
  // 2. TRAINERS
  // ─────────────────────────────────────────────
  await User.deleteMany({ role: 'trainer' });
  const trainerPassword = await bcrypt.hash('trainer123', 10);
  const trainers = await User.insertMany([
    {
      name: 'Rahul Verma',
      email: 'rahul@fitnation.com',
      phone: '9876543210',
      password: trainerPassword,
      role: 'trainer',
      gender: 'male',
      specialization: 'Strength & Bodybuilding',
      avatar: U('photo-1534528741775-53994a69daeb', 200),
      isActive: true,
    },
    {
      name: 'Priya Sharma',
      email: 'priya@fitnation.com',
      phone: '9876543211',
      password: trainerPassword,
      role: 'trainer',
      gender: 'female',
      specialization: 'Fat Loss & Functional Fitness',
      avatar: U('photo-1573496359142-b8d87734a5a2', 200),
      isActive: true,
    },
    {
      name: 'Karan Mehta',
      email: 'karan@fitnation.com',
      phone: '9876543212',
      password: trainerPassword,
      role: 'trainer',
      gender: 'male',
      specialization: 'CrossFit & Conditioning',
      avatar: U('photo-1507003211169-0a1dd7228f2d', 200),
      isActive: true,
    },
  ]);
  console.log(`✅ Seeded ${trainers.length} trainers`);

  // ─────────────────────────────────────────────
  // 3. MEMBERS
  // ─────────────────────────────────────────────
  await User.deleteMany({ role: 'member' });
  const now = new Date();
  const future = (days) => new Date(now.getTime() + days * 86400000);
  const past   = (days) => new Date(now.getTime() - days * 86400000);
  const memberPassword = await bcrypt.hash('member123', 10);

  const membersData = [
    { name: 'Aman Gupta',    email: 'aman@gmail.com',    phone: '9111111111', gender: 'male',   membershipPlan: 'monthly',    membershipStart: past(10),  membershipEnd: future(20), membershipStatus: 'active',  feePaid: true,  feeAmount: 1500, feeDueAmount: 0, assignedTrainer: trainers[0]._id, avatar: U('photo-1500648767791-00dcc994a43e', 200) },
    { name: 'Sneha Patil',   email: 'sneha@gmail.com',   phone: '9111111112', gender: 'female', membershipPlan: 'quarterly',  membershipStart: past(30),  membershipEnd: future(60), membershipStatus: 'active',  feePaid: true,  feeAmount: 3800, feeDueAmount: 0, assignedTrainer: trainers[1]._id, avatar: U('photo-1494790108377-be9c29b29330', 200) },
    { name: 'Rohit Joshi',   email: 'rohit@gmail.com',   phone: '9111111113', gender: 'male',   membershipPlan: 'half-yearly',membershipStart: past(60),  membershipEnd: future(120),membershipStatus: 'active',  feePaid: true,  feeAmount: 6500, feeDueAmount: 0, assignedTrainer: trainers[0]._id, avatar: U('photo-1506794778202-cad84cf45f1d', 200) },
    { name: 'Neha Singh',    email: 'neha@gmail.com',    phone: '9111111114', gender: 'female', membershipPlan: 'yearly',     membershipStart: past(90),  membershipEnd: future(275),membershipStatus: 'active',  feePaid: true,  feeAmount: 11500,feeDueAmount: 0, assignedTrainer: trainers[2]._id, avatar: U('photo-1534528741775-53994a69daeb', 200) },
    { name: 'Vikas Kumar',   email: 'vikas@gmail.com',   phone: '9111111115', gender: 'male',   membershipPlan: 'monthly',    membershipStart: past(5),   membershipEnd: future(2),  membershipStatus: 'active',  feePaid: false, feeAmount: 1500, feeDueAmount: 1500, assignedTrainer: trainers[1]._id, avatar: U('photo-1519085360753-af0119f7cbe7', 200) },
    { name: 'Divya Rao',     email: 'divya@gmail.com',   phone: '9111111116', gender: 'female', membershipPlan: 'monthly',    membershipStart: past(40),  membershipEnd: past(10),   membershipStatus: 'expired', feePaid: false, feeAmount: 1500, feeDueAmount: 1500, assignedTrainer: trainers[2]._id, avatar: U('photo-1544005313-94ddf0286df2', 200) },
    { name: 'Sanjay Patel',  email: 'sanjay@gmail.com',  phone: '9111111117', gender: 'male',   membershipPlan: 'quarterly',  membershipStart: past(20),  membershipEnd: future(70), membershipStatus: 'active',  feePaid: true,  feeAmount: 3800, feeDueAmount: 0, assignedTrainer: trainers[0]._id, avatar: U('photo-1522075469751-3a6694fb2f61', 200) },
    { name: 'Ankita Mishra', email: 'ankita@gmail.com',  phone: '9111111118', gender: 'female', membershipPlan: 'half-yearly',membershipStart: past(10),  membershipEnd: future(170),membershipStatus: 'active',  feePaid: true,  feeAmount: 6500, feeDueAmount: 0, assignedTrainer: trainers[1]._id, avatar: U('photo-1517841905240-472988babdf9', 200) },
    { name: 'Deepak Nair',   email: 'deepak@gmail.com',  phone: '9111111119', gender: 'male',   membershipPlan: 'monthly',    membershipStart: past(2),   membershipEnd: future(28), membershipStatus: 'active',  feePaid: true,  feeAmount: 1500, feeDueAmount: 0, assignedTrainer: trainers[2]._id, avatar: U('photo-1539571696357-5a69c17a67c6', 200) },
    { name: 'Pooja Tiwari',  email: 'pooja@gmail.com',   phone: '9111111120', gender: 'female', membershipPlan: 'yearly',     membershipStart: past(100), membershipEnd: future(265),membershipStatus: 'active',  feePaid: true,  feeAmount: 11500,feeDueAmount: 0, assignedTrainer: trainers[0]._id, avatar: U('photo-1524504388940-b1c1722653e1', 200) },
  ];
  const members = await User.insertMany(
    membersData.map(m => ({ ...m, password: memberPassword, role: 'member', isActive: true }))
  );
  console.log(`✅ Seeded ${members.length} members`);

  // ─────────────────────────────────────────────
  // 4. MEMBERSHIP PLANS
  // ─────────────────────────────────────────────
  await MembershipPlan.deleteMany({});
  await MembershipPlan.insertMany([
    {
      name: 'Monthly',
      slug: 'monthly',
      durationDays: 30,
      price: 1500,
      isPopular: false,
      isActive: true,
      features: ['Full Gym Floor Access', 'Locker Room & Shower', 'Basic Fitness Assessment', 'Free WiFi Access']
    },
    {
      name: 'Quarterly',
      slug: 'quarterly',
      durationDays: 90,
      price: 3800,
      isPopular: false,
      isActive: true,
      features: ['Full Gym Floor Access', 'Locker Room & Shower', 'Fitness Assessment', '1 Personal Trainer Consultation', '1 Customized Diet Plan']
    },
    {
      name: 'Half-Yearly',
      slug: 'half-yearly',
      durationDays: 180,
      price: 6500,
      isPopular: true,
      isActive: true,
      features: ['Full Gym Floor Access', 'Locker Room & Shower', 'Fitness Assessment', 'Bi-weekly Body Composition Check', 'Personal Trainer Support (2x/month)', 'Full Nutrition Plan', '10% Store Discount']
    },
    {
      name: 'Yearly',
      slug: 'yearly',
      durationDays: 365,
      price: 11500,
      isPopular: false,
      isActive: true,
      features: ['Unlimited 365-Day Access', 'Dedicated Locker', 'Comprehensive Bi-Weekly Fitness Assessment', 'Dedicated Personal Trainer (8x/month)', 'Personalised Diet Plan & Adjustments', '15% Store Discount', 'Guest Pass (2/month)']
    },
  ]);
  console.log('✅ Seeded 4 membership plans');

  // ─────────────────────────────────────────────
  // 5. EXERCISES (WITH MATCHING PHOTOS & VIDEOS)
  // ─────────────────────────────────────────────
  await Exercise.deleteMany({});
  const exerciseData = [
    // Chest
    {
      title: 'Barbell Bench Press',
      muscleGroup: 'chest',
      difficulty: 'intermediate',
      equipmentNeeded: 'Barbell, Flat Bench',
      sets: '4', reps: '8-10',
      description: 'The foundation for upper body pushing strength and chest hypertrophy.',
      instructions: '1. Lie flat with eyes directly under the bar.\n2. Grip slightly wider than shoulder width.\n3. Lower bar with control to lower chest.\n4. Drive through the feet and press upward lockout.',
      image: U('photo-1517838277536-f5f99be501cd'),
      videoUrl: yt('rT7DgCr-3pg'),
      isPublic: true
    },
    {
      title: 'Incline Dumbbell Press',
      muscleGroup: 'chest',
      difficulty: 'intermediate',
      equipmentNeeded: 'Dumbbells, Incline Bench',
      sets: '4', reps: '10-12',
      description: 'Isolates and overloads the clavicular (upper) head of the pectoralis major.',
      instructions: '1. Set bench to 30-45 degree incline.\n2. Press dumbbells vertically over shoulders.\n3. Lower with elbows tucked at 45 degrees.\n4. Squeeze chest firmly at peak contraction.',
      image: U('photo-1581009146145-b5ef050c2e1e'),
      videoUrl: yt('8iPEnn-ltC8'),
      isPublic: true
    },
    {
      title: 'Cable Chest Fly',
      muscleGroup: 'chest',
      difficulty: 'beginner',
      equipmentNeeded: 'Cable Machine',
      sets: '3', reps: '12-15',
      description: 'Provides constant tension throughout the entire range of motion for chest definition.',
      instructions: '1. Set pulleys at chest height.\n2. Step forward with a slight staggered stance.\n3. Bring handles together in a wide hugging arc.\n4. Hold the peak contraction for 1 second.',
      image: U('photo-1534438327276-14e5300c3a48'),
      videoUrl: yt('Iwe6AmxVf7o'),
      isPublic: true
    },
    {
      title: 'Push-Up',
      muscleGroup: 'chest',
      difficulty: 'beginner',
      equipmentNeeded: 'Bodyweight',
      sets: '3', reps: '15-20',
      description: 'Fundamental calisthenics movement targeting chest, shoulders, triceps, and core.',
      instructions: '1. Hands slightly wider than shoulders on floor.\n2. Body in a straight rigid plank line.\n3. Lower chest until elbows reach 90 degrees.\n4. Push the floor away back to the start.',
      image: U('photo-1598971639058-fab3c3109a00'),
      videoUrl: yt('IODxDxX7oi4'),
      isPublic: true
    },
    {
      title: 'Dips',
      muscleGroup: 'chest',
      difficulty: 'intermediate',
      equipmentNeeded: 'Dip Station / Parallel Bars',
      sets: '3', reps: '10-12',
      description: 'Targeting lower chest and triceps with great athletic strength development.',
      instructions: '1. Grip parallel bars and mount.\n2. Lean torso forward 30 degrees to bias chest.\n3. Lower until upper arms are parallel to floor.\n4. Press back up without locking shoulders forward.',
      image: U('photo-1571019613454-1cb2f99b2d8b'),
      videoUrl: yt('2z8JmcrW-As'),
      isPublic: true
    },

    // Back
    {
      title: 'Deadlift',
      muscleGroup: 'back',
      difficulty: 'advanced',
      equipmentNeeded: 'Barbell, Olympic Plates',
      sets: '4', reps: '5-6',
      description: 'King of compound exercises for posterior chain strength, traps, and spinal erectors.',
      instructions: '1. Stand with bar over mid-foot.\n2. Hinge hips back and grip bar.\n3. Pull chest up, brace core, and flatten back.\n4. Drive hips forward and push floor away.',
      image: U('photo-1517836357463-d25dfeac3438'),
      videoUrl: yt('op9kVnSso6Q'),
      isPublic: true
    },
    {
      title: 'Pull-Up',
      muscleGroup: 'back',
      difficulty: 'intermediate',
      equipmentNeeded: 'Pull-Up Bar',
      sets: '4', reps: '6-10',
      description: 'Premier bodyweight movement for massive lat development and V-taper.',
      instructions: '1. Hang from bar with hands just outside shoulders.\n2. Pull elbows down and bring upper chest to the bar.\n3. Pause briefly at the top.\n4. Lower under control to a full dead hang.',
      image: U('photo-1597452485669-2c7bb5fef90d'),
      videoUrl: yt('eGo4IYlbE5g'),
      isPublic: true
    },
    {
      title: 'Barbell Row',
      muscleGroup: 'back',
      difficulty: 'intermediate',
      equipmentNeeded: 'Barbell',
      sets: '4', reps: '8-10',
      description: 'Builds incredible back thickness across rhomboids, mid traps, and lats.',
      instructions: '1. Hinge at hips to a 45 degree angle.\n2. Keep spine straight and chest proud.\n3. Pull barbell into lower ribs/belly button.\n4. Squeeze shoulder blades together firmly.',
      image: U('photo-1605296867304-46d5465a13f1'),
      videoUrl: yt('FWJR5Ve8gkQ'),
      isPublic: true
    },
    {
      title: 'Lat Pulldown',
      muscleGroup: 'back',
      difficulty: 'beginner',
      equipmentNeeded: 'Cable Pulldown Machine',
      sets: '3', reps: '10-12',
      description: 'Controlled vertical pulling exercise to develop lat width with adjustable resistance.',
      instructions: '1. Lock thighs firmly under pad.\n2. Grip wide overhand bar.\n3. Pull bar smoothly to upper clavicle.\n4. Control bar back up with arms fully extended.',
      image: U('photo-1526506118085-60ce8714f8c5'),
      videoUrl: yt('SALxEARiMkw'),
      isPublic: true
    },
    {
      title: 'Seated Cable Row',
      muscleGroup: 'back',
      difficulty: 'beginner',
      equipmentNeeded: 'Seated Cable Row Machine',
      sets: '3', reps: '12-15',
      description: 'Great for middle back thickness and postural correction.',
      instructions: '1. Sit upright with knees slightly flexed.\n2. Pull V-bar handle into navel.\n3. Drive elbows back and retract scaps.\n4. Slowly extend arms back without rounding lower back.',
      image: U('photo-1583454110551-21f2fa2afe61'),
      videoUrl: yt('GZbfZ033f74'),
      isPublic: true
    },

    // Shoulders
    {
      title: 'Overhead Press',
      muscleGroup: 'shoulders',
      difficulty: 'intermediate',
      equipmentNeeded: 'Barbell',
      sets: '4', reps: '8-10',
      description: 'Strict standing barbell press for overall shoulder width and overhead pressing power.',
      instructions: '1. Grip barbell at shoulder width.\n2. Brace glutes and abs tightly.\n3. Press the bar straight up clearing the chin.\n4. Lock out overhead with head pushed slightly through.',
      image: U('photo-1532029837206-abbe2b7620e3'),
      videoUrl: yt('2yjwXTZQDDI'),
      isPublic: true
    },
    {
      title: 'Lateral Raise',
      muscleGroup: 'shoulders',
      difficulty: 'beginner',
      equipmentNeeded: 'Dumbbells',
      sets: '4', reps: '12-15',
      description: 'Direct isolation for the lateral deltoids to create a 3D capped shoulder appearance.',
      instructions: '1. Hold dumbbells at sides with slight forward torso lean.\n2. Raise arms out to sides leading with elbows.\n3. Stop at shoulder height.\n4. Lower with strict control.',
      image: U('photo-1581009146145-b5ef050c2e1e'),
      videoUrl: yt('3VcKaXpzqRo'),
      isPublic: true
    },
    {
      title: 'Arnold Press',
      muscleGroup: 'shoulders',
      difficulty: 'intermediate',
      equipmentNeeded: 'Dumbbells, Bench',
      sets: '3', reps: '10-12',
      description: 'Rotational shoulder press pioneered by Arnold Schwarzenegger for complete deltoid recruitment.',
      instructions: '1. Start dumbbells at chest level, palms facing you.\n2. Rotate palms outward as you press upward.\n3. At the top, palms face forward.\n4. Reverse rotation slowly on the descent.',
      image: U('photo-1584735935682-2f2b69dff9d2'),
      videoUrl: yt('6Z15_WdXmVw'),
      isPublic: true
    },
    {
      title: 'Face Pull',
      muscleGroup: 'shoulders',
      difficulty: 'beginner',
      equipmentNeeded: 'Cable Machine, Rope',
      sets: '3', reps: '15-20',
      description: 'Essential bulletproofing exercise for rear delts, rotator cuffs, and shoulder health.',
      instructions: '1. Set rope pulley at eye level.\n2. Pull rope attachment toward bridge of nose.\n3. Externally rotate hands at end of movement.\n4. Squeeze rear shoulders and hold 1 count.',
      image: U('photo-1517836357463-d25dfeac3438'),
      videoUrl: yt('rep-qVOkqgk'),
      isPublic: true
    },

    // Arms
    {
      title: 'Barbell Bicep Curl',
      muscleGroup: 'arms',
      difficulty: 'beginner',
      equipmentNeeded: 'Barbell / EZ Bar',
      sets: '4', reps: '10-12',
      description: 'The heavyweight bicep builder for overall mass and forearm strength.',
      instructions: '1. Stand upright with elbows pinned to ribs.\n2. Curl the barbell up along an arc.\n3. Squeeze biceps hard at top.\n4. Lower slowly under control.',
      image: U('photo-1581009146145-b5ef050c2e1e'),
      videoUrl: yt('kwG2ipFRgfo'),
      isPublic: true
    },
    {
      title: 'Hammer Curl',
      muscleGroup: 'arms',
      difficulty: 'beginner',
      equipmentNeeded: 'Dumbbells',
      sets: '3', reps: '12-15',
      description: 'Neutral-grip curl targeting the brachialis and brachioradialis for arm thickness.',
      instructions: '1. Hold dumbbells with palms facing each other.\n2. Curl dumbbells upward keeping neutral grip.\n3. Do not swing elbows or rock body.\n4. Lower down with constant tension.',
      image: U('photo-1534438327276-14e5300c3a48'),
      videoUrl: yt('zC3nLlEvin4'),
      isPublic: true
    },
    {
      title: 'Tricep Pushdown',
      muscleGroup: 'arms',
      difficulty: 'beginner',
      equipmentNeeded: 'Cable Machine, Rope / Bar',
      sets: '4', reps: '12-15',
      description: 'Strict isolation targeting the lateral and medial heads of the triceps.',
      instructions: '1. Keep elbows locked at your side ribs.\n2. Push cable attachment down until elbows fully straighten.\n3. Flare rope slightly at bottom for maximal contraction.\n4. Return smoothly to 90 degrees.',
      image: U('photo-1583454110551-21f2fa2afe61'),
      videoUrl: yt('2-LAMcpzODU'),
      isPublic: true
    },
    {
      title: 'Skull Crusher',
      muscleGroup: 'arms',
      difficulty: 'intermediate',
      equipmentNeeded: 'EZ Bar, Flat Bench',
      sets: '3', reps: '10-12',
      description: 'Lying tricep extension targeting the long head of the triceps for upper arm size.',
      instructions: '1. Lie on bench with EZ bar held over chest.\n2. Hinge only at elbows to lower bar toward forehead.\n3. Keep upper arms motionless.\n4. Extend back up to the start.',
      image: U('photo-1584735935682-2f2b69dff9d2'),
      videoUrl: yt('d_KZxkY_0cM'),
      isPublic: true
    },

    // Legs
    {
      title: 'Barbell Squat',
      muscleGroup: 'legs',
      difficulty: 'advanced',
      equipmentNeeded: 'Barbell, Squat Rack',
      sets: '4', reps: '6-8',
      description: 'The premier lower body compound builder for quads, hamstrings, glutes, and core.',
      instructions: '1. Position bar across upper traps.\n2. Stand with feet slightly wider than shoulder width.\n3. Squat down until hips are below parallel.\n4. Drive through mid-foot to return upright.',
      image: U('photo-1574680096145-d05b474e2155'),
      videoUrl: yt('bEv6CCg2BC8'),
      isPublic: true
    },
    {
      title: 'Romanian Deadlift',
      muscleGroup: 'legs',
      difficulty: 'intermediate',
      equipmentNeeded: 'Barbell / Dumbbells',
      sets: '4', reps: '10-12',
      description: 'Hip-hinge movement that stretches and strengthens hamstrings and glutes.',
      instructions: '1. Stand tall with bar at hip level.\n2. Push hips straight back with soft knees.\n3. Lower bar down shins until deep hamstring stretch.\n4. Drive hips forward to stand.',
      image: U('photo-1517836357463-d25dfeac3438'),
      videoUrl: yt('JCXUYuzwNrM'),
      isPublic: true
    },
    {
      title: 'Leg Press',
      muscleGroup: 'legs',
      difficulty: 'beginner',
      equipmentNeeded: 'Leg Press Machine',
      sets: '4', reps: '12-15',
      description: 'Heavy quad and leg overload without spinal compression.',
      instructions: '1. Place feet hip-width on sled platform.\n2. Lower weight until knees reach 90 degrees.\n3. Do not allow lower back to peel off seat.\n4. Press back up without hyper-locking knees.',
      image: U('photo-1434682881908-b43d0467b798'),
      videoUrl: yt('IZxyjW7MPJQ'),
      isPublic: true
    },
    {
      title: 'Lunges',
      muscleGroup: 'legs',
      difficulty: 'beginner',
      equipmentNeeded: 'Dumbbells / Bodyweight',
      sets: '3', reps: '12 each',
      description: 'Unilateral leg builder that improves balance, quad strength, and glute activation.',
      instructions: '1. Step forward with one leg.\n2. Lower body until front thigh is parallel to ground.\n3. Front knee aligns directly over front ankle.\n4. Push back to starting position and switch legs.',
      image: U('photo-1571019613454-1cb2f99b2d8b'),
      videoUrl: yt('QOVaHwm-Q6U'),
      isPublic: true
    },

    // Core
    {
      title: 'Plank',
      muscleGroup: 'core',
      difficulty: 'beginner',
      equipmentNeeded: 'Yoga Mat',
      sets: '3', reps: '45-60 sec', duration: '60 sec',
      description: 'Isometric anti-extension core hold that develops deep abdominal endurance.',
      instructions: '1. Rest forearms on floor with elbows beneath shoulders.\n2. Squeeze glutes and brace core tight.\n3. Maintain flat spine from head to heels.\n4. Breathe steadily throughout hold.',
      image: U('photo-1566241142559-40e1dab266c6'),
      videoUrl: yt('pSHjTRCQxIw'),
      isPublic: true
    },
    {
      title: 'Hanging Leg Raise',
      muscleGroup: 'core',
      difficulty: 'intermediate',
      equipmentNeeded: 'Pull-Up Bar',
      sets: '3', reps: '12-15',
      description: 'Advanced lower abdominal and hip flexor exercise performed hanging from a bar.',
      instructions: '1. Hang from pull-up bar with overhand grip.\n2. Raise straight legs up to 90 degrees or higher.\n3. Avoid swinging or relying on momentum.\n4. Lower legs slowly with controlled tension.',
      image: U('photo-1597452485669-2c7bb5fef90d'),
      videoUrl: yt('hdng3Nm1x_E'),
      isPublic: true
    },
    {
      title: 'Cable Crunch',
      muscleGroup: 'core',
      difficulty: 'beginner',
      equipmentNeeded: 'Cable Machine, Rope',
      sets: '3', reps: '15-20',
      description: 'Weighted abdominal flexion that allows progressive overload for abdominal definition.',
      instructions: '1. Kneel facing cable with rope held beside head.\n2. Crunch ribcage down toward pelvis.\n3. Round back to engage rectus abdominis.\n4. Return under control without moving hips.',
      image: U('photo-1571019613454-1cb2f99b2d8b'),
      videoUrl: yt('2fbujeh3pHg'),
      isPublic: true
    },

    // Cardio & Conditioning
    {
      title: 'Treadmill HIIT',
      muscleGroup: 'cardio',
      difficulty: 'intermediate',
      equipmentNeeded: 'Treadmill',
      sets: '8', reps: '30s sprint / 60s walk', duration: '15 min',
      description: 'High-intensity interval cardio that maximizes calorie expenditure and VO2 max.',
      instructions: '1. Warm up with 3 minutes brisk walk.\n2. Sprint at 85-90% max speed for 30 seconds.\n3. Drop speed to slow walk for 60 seconds active recovery.\n4. Repeat for 8 full rounds.',
      image: U('photo-1538805060514-97d9cc17730c'),
      videoUrl: yt('pPn3i5k_84w'),
      isPublic: true
    },
    {
      title: 'Jump Rope',
      muscleGroup: 'cardio',
      difficulty: 'beginner',
      equipmentNeeded: 'Speed Jump Rope',
      sets: '5', reps: '60 sec', duration: '10 min',
      description: 'Exceptional cardiovascular conditioning, foot speed, coordination, and calf endurance.',
      instructions: '1. Keep elbows tucked close to waist.\n2. Rotate rope using only wrists.\n3. Stay on balls of feet with minimal knee bend.\n4. Maintain smooth steady rhythm.',
      image: U('photo-1518611012118-696072aa579a'),
      videoUrl: yt('u3zgHI8YCyo'),
      isPublic: true
    },
    {
      title: 'Battle Ropes',
      muscleGroup: 'cardio',
      difficulty: 'intermediate',
      equipmentNeeded: 'Battle Ropes',
      sets: '6', reps: '30 sec', duration: '10 min',
      description: 'Full-body conditioning and metabolic conditioning with minimal joint impact.',
      instructions: '1. Hold handles in athletic half-squat stance.\n2. Alternately wave arms explosively up and down.\n3. Keep core braced to absorb vibration.\n4. Maintain intense wave rhythm for 30s.',
      image: U('photo-1517836357463-d25dfeac3438'),
      videoUrl: yt('r3v3bU1n24E'),
      isPublic: true
    },

    // Full Body
    {
      title: 'Burpee',
      muscleGroup: 'full-body',
      difficulty: 'intermediate',
      equipmentNeeded: 'Bodyweight',
      sets: '4', reps: '12-15',
      description: 'Explosive bodyweight movement challenging lungs, legs, and upper body.',
      instructions: '1. From standing drop into a squat and place hands on floor.\n2. Kick feet back into push-up position and perform push-up.\n3. Jump feet back to hands.\n4. Explode upward into jump with arms overhead.',
      image: U('photo-1598971639058-fab3c3109a00'),
      videoUrl: yt('dZgVxmf6jkA'),
      isPublic: true
    },
    {
      title: 'Kettlebell Swing',
      muscleGroup: 'full-body',
      difficulty: 'beginner',
      equipmentNeeded: 'Kettlebell',
      sets: '4', reps: '15-20',
      description: 'Explosive posterior chain exercise that builds hip drive, glutes, and grip strength.',
      instructions: '1. Feet shoulder width, hinge hips back with soft knees.\n2. Hike kettlebell between legs.\n3. Snap hips violently forward to float bell to chest level.\n4. Let gravity bring bell down into next hinge.',
      image: U('photo-1517836357463-d25dfeac3438'),
      videoUrl: yt('sSESeQAlb2U'),
      isPublic: true
    },
  ];

  const exercises = await Exercise.insertMany(
    exerciseData.map(e => ({
      ...e,
      uploadedBy: admin._id,
      createdBy: admin._id,
      tags: [e.muscleGroup, e.difficulty]
    }))
  );
  console.log(`✅ Seeded ${exercises.length} exercises with matching media`);

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
        { day: 'Monday',    focus: 'Push – Chest & Triceps',  exercises: [ex('Barbell Bench Press'), ex('Incline Dumbbell Press'), ex('Cable Chest Fly'), ex('Tricep Pushdown'), ex('Skull Crusher')], notes: 'Rest 90s between heavy sets' },
        { day: 'Tuesday',   focus: 'Pull – Back & Biceps',    exercises: [ex('Deadlift'), ex('Pull-Up'), ex('Barbell Row'), ex('Lat Pulldown'), ex('Barbell Bicep Curl'), ex('Hammer Curl')], notes: 'Focus on mind-muscle lat contraction' },
        { day: 'Wednesday', focus: 'Legs & Calves',           exercises: [ex('Barbell Squat'), ex('Romanian Deadlift'), ex('Leg Press'), ex('Lunges')], notes: 'Thorough warm up before squats' },
        { day: 'Thursday',  focus: 'Push – Shoulders & Chest',exercises: [ex('Overhead Press'), ex('Arnold Press'), ex('Lateral Raise'), ex('Dips'), ex('Face Pull')], notes: 'Keep strict shoulder form' },
        { day: 'Friday',    focus: 'Pull – Upper Back & Arms',exercises: [ex('Pull-Up'), ex('Seated Cable Row'), ex('Lat Pulldown'), ex('Barbell Bicep Curl'), ex('Hammer Curl')], notes: 'High volume back isolation' },
        { day: 'Saturday',  focus: 'Legs & Core',             exercises: [ex('Barbell Squat'), ex('Leg Press'), ex('Plank'), ex('Hanging Leg Raise'), ex('Cable Crunch')], notes: 'Intense core finish' },
        { day: 'Sunday',    focus: 'Rest & Recovery',         exercises: [], notes: 'Active walk, stretching, hydration' },
      ]
    },
    {
      title: 'Full Body Strength (5x5)',
      createdBy: admin._id,
      goal: 'strength',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Full Body Heavy A',  exercises: [ex('Barbell Squat'), ex('Barbell Bench Press'), ex('Barbell Row'), ex('Overhead Press'), ex('Plank')], notes: '5 sets of 5 reps on main compounds' },
        { day: 'Tuesday',   focus: 'Rest',               exercises: [], notes: 'Hydrate and sleep 8 hours' },
        { day: 'Wednesday', focus: 'Full Body Heavy B',  exercises: [ex('Deadlift'), ex('Pull-Up'), ex('Dips'), ex('Romanian Deadlift'), ex('Cable Crunch')], notes: 'Prioritize posture over weight' },
        { day: 'Thursday',  focus: 'Rest',               exercises: [], notes: 'Light mobility work' },
        { day: 'Friday',    focus: 'Full Body Heavy C',  exercises: [ex('Barbell Squat'), ex('Incline Dumbbell Press'), ex('Seated Cable Row'), ex('Lunges')], notes: 'Build volume' },
        { day: 'Saturday',  focus: 'Conditioning',       exercises: [ex('Treadmill HIIT'), ex('Jump Rope'), ex('Battle Ropes')], notes: '25 minutes metabolic conditioning' },
        { day: 'Sunday',    focus: 'Rest',               exercises: [], notes: 'Full day rest' },
      ]
    },
    {
      title: 'Fat Loss & Conditioning Circuit',
      createdBy: admin._id,
      goal: 'fat_loss',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Upper Body Metabolic', exercises: [ex('Push-Up'), ex('Pull-Up'), ex('Dips'), ex('Barbell Row'), ex('Battle Ropes')], notes: '45 seconds rest between circuits' },
        { day: 'Tuesday',   focus: 'HIIT & Core',          exercises: [ex('Treadmill HIIT'), ex('Jump Rope'), ex('Burpee'), ex('Plank')], notes: 'High heart rate session' },
        { day: 'Wednesday', focus: 'Lower Body Burn',      exercises: [ex('Barbell Squat'), ex('Lunges'), ex('Leg Press'), ex('Kettlebell Swing')], notes: 'High reps (15-20)' },
        { day: 'Thursday',  focus: 'Active Core',          exercises: [ex('Plank'), ex('Hanging Leg Raise'), ex('Cable Crunch'), ex('Jump Rope')], notes: 'Core stabilization' },
        { day: 'Friday',    focus: 'Full Body MetCon',     exercises: [ex('Kettlebell Swing'), ex('Burpee'), ex('Battle Ropes'), ex('Push-Up')], notes: '4 rounds for time' },
        { day: 'Saturday',  focus: 'Steady Cardio',        exercises: [ex('Treadmill HIIT'), ex('Jump Rope')], notes: '40 minutes steady cardio' },
        { day: 'Sunday',    focus: 'Rest',                 exercises: [], notes: 'Rest day' },
      ]
    },
    {
      title: 'Beginner Gym Starter Split',
      createdBy: trainers[0]._id,
      goal: 'general',
      isDefault: true,
      days: [
        { day: 'Monday',    focus: 'Chest & Arms',   exercises: [ex('Push-Up'), ex('Cable Chest Fly'), ex('Barbell Bicep Curl'), ex('Tricep Pushdown')], notes: 'Learn movements with light weight' },
        { day: 'Tuesday',   focus: 'Back & Core',    exercises: [ex('Lat Pulldown'), ex('Seated Cable Row'), ex('Plank')], notes: 'Focus on mind-muscle connection' },
        { day: 'Wednesday', focus: 'Legs & Glutes',  exercises: [ex('Leg Press'), ex('Lunges')], notes: 'Proper knee tracking' },
        { day: 'Thursday',  focus: 'Shoulders',      exercises: [ex('Lateral Raise'), ex('Face Pull')], notes: 'Controlled tempo' },
        { day: 'Friday',    focus: 'Full Body Light',exercises: [ex('Barbell Bench Press'), ex('Lat Pulldown'), ex('Barbell Squat')], notes: 'Compound movement fundamentals' },
        { day: 'Saturday',  focus: 'Light Cardio',   exercises: [ex('Jump Rope')], notes: 'Fun cardio session' },
        { day: 'Sunday',    focus: 'Rest',           exercises: [], notes: 'Rest day' },
      ]
    },
  ]);
  console.log('✅ Seeded 4 workout splits');

  // ─────────────────────────────────────────────
  // 7. PRODUCTS (STORE)
  // ─────────────────────────────────────────────
  await Product.deleteMany({});
  const products = await Product.insertMany([
    {
      name: 'Optimum Nutrition Gold Standard 100% Whey',
      category: 'protein',
      brand: 'Optimum Nutrition',
      description: 'The world\'s #1 selling whey protein. Packed with 24g of high quality whey isolate, 5.5g naturally occurring BCAAs, and 4g glutamine per serving.',
      price: 4499,
      discountPrice: 3899,
      stock: 45,
      flavors: ['Double Rich Chocolate', 'French Vanilla', 'Delicious Strawberry', 'Mocha Cappuccino'],
      weights: ['1kg', '2kg', '5lb'],
      rating: 4.8,
      reviewCount: 312,
      isFeatured: true,
      isActive: true,
      images: [U('photo-1593095948071-474c5cc2989d')],
    },
    {
      name: 'MuscleBlaze Raw Whey Isolate 90%',
      category: 'protein',
      brand: 'MuscleBlaze',
      description: 'Unflavoured ultra-pure whey protein isolate with zero added sugar and 27g protein per 30g scoop. Ideal for pure lean muscle gains.',
      price: 2999,
      discountPrice: 2499,
      stock: 60,
      flavors: ['Unflavoured'],
      weights: ['1kg', '2kg'],
      rating: 4.6,
      reviewCount: 184,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1559181567-c3190ca9d222')],
    },
    {
      name: 'Dymatize ISO 100 Hydrolyzed Whey',
      category: 'protein',
      brand: 'Dymatize',
      description: 'Super fast-digesting hydrolyzed 100% whey protein isolate with less than 1g of sugar and fat. Perfect for rapid post-workout recovery.',
      price: 5499,
      discountPrice: 4799,
      stock: 25,
      flavors: ['Gourmet Chocolate', 'Birthday Cake', 'Fruity Pebbles', 'Smooth Vanilla'],
      weights: ['1.4kg', '2.3kg'],
      rating: 4.9,
      reviewCount: 145,
      isFeatured: true,
      isActive: true,
      images: [U('photo-1571019614242-c5c5dee9f50b')],
    },
    {
      name: 'MuscleTech Platinum 100% Creatine Monohydrate',
      category: 'creatine',
      brand: 'MuscleTech',
      description: 'Ultra-pure micronized creatine monohydrate. Clinically shown to build lean muscle and improve strength by 18.6%. 5g pure creatine per scoop.',
      price: 1299,
      discountPrice: 999,
      stock: 80,
      flavors: ['Unflavoured'],
      weights: ['250g', '400g'],
      rating: 4.7,
      reviewCount: 420,
      isFeatured: true,
      isActive: true,
      images: [U('photo-1526947425960-945c6e72858f')],
    },
    {
      name: 'Cellucor C4 Original Pre-Workout',
      category: 'pre-workout',
      brand: 'Cellucor',
      description: 'Explosive pre-workout energy with 150mg caffeine, CarnoSyn Beta-Alanine, and Arginine AKG for energy, pumps, and focus.',
      price: 2299,
      discountPrice: 1899,
      stock: 50,
      flavors: ['Fruit Punch', 'Icy Blue Razz', 'Watermelon', 'Cherry Limeade'],
      weights: ['30 Servings', '60 Servings'],
      rating: 4.5,
      reviewCount: 260,
      isFeatured: true,
      isActive: true,
      images: [U('photo-1546519638-68e109498ffc')],
    },
    {
      name: 'Optimum Nutrition Serious Mass Gainer',
      category: 'weight-gainer',
      brand: 'Optimum Nutrition',
      description: 'High calorie weight gainer formula with 1250 calories, 50g protein, and over 250g carbohydrates per serving. Ideal for hardgainers.',
      price: 3999,
      discountPrice: 3499,
      stock: 30,
      flavors: ['Chocolate', 'Vanilla', 'Banana'],
      weights: ['2.7kg', '5.4kg'],
      rating: 4.4,
      reviewCount: 198,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1531545514256-b1400bc00f31')],
    },
    {
      name: 'Scivation Xtend BCAA Recovery',
      category: 'bcaa',
      brand: 'Scivation',
      description: '7g BCAAs in the proven 2:1:1 ratio, plus electrolytes and glutamine to support muscle recovery and hydration during workouts.',
      price: 2199,
      discountPrice: 1799,
      stock: 65,
      flavors: ['Blue Raspberry Ice', 'Watermelon Explosion', 'Mango Madness'],
      weights: ['30 Servings', '90 Servings'],
      rating: 4.7,
      reviewCount: 154,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1550572017-9b4b5e8c0b3c')],
    },
    {
      name: 'Triple Strength Omega-3 Fish Oil 1000mg',
      category: 'vitamins',
      brand: 'HealthKart',
      description: 'Concentrated EPA & DHA fish oil softgels supporting joint flexibility, cardiovascular health, and reducing post-exercise soreness.',
      price: 899,
      discountPrice: 699,
      stock: 110,
      flavors: [],
      weights: ['60 Softgels', '120 Softgels'],
      rating: 4.6,
      reviewCount: 140,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1631549916768-4119b2e5f926')],
    },
    {
      name: 'Daily Multivitamin For Athletes',
      category: 'vitamins',
      brand: 'FitNation',
      description: 'Complete daily spectrum of 28 vitamins, minerals, and herbal extracts designed specifically to support intense athletic performance.',
      price: 799,
      discountPrice: 599,
      stock: 95,
      flavors: [],
      weights: ['60 Tablets', '120 Tablets'],
      rating: 4.5,
      reviewCount: 110,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1607619056574-7b8d3ee536b2')],
    },
    {
      name: 'Lipo-6 Black Ultra Concentrate Fat Burner',
      category: 'fat-burner',
      brand: 'Nutrex',
      description: 'Potent thermogenic fat burning formula designed to boost resting metabolic rate, elevate energy, and control appetite.',
      price: 2299,
      discountPrice: 1899,
      stock: 35,
      flavors: [],
      weights: ['60 Capsules'],
      rating: 4.3,
      reviewCount: 92,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1582719188393-bb71ca45dbb9')],
    },
    {
      name: 'FitNation Pro Grip Leather Lifting Gloves',
      category: 'accessories',
      brand: 'FitNation',
      description: 'Heavy duty genuine leather lifting gloves with built-in wrist wrap support, silicone palm grip, and breathable mesh back.',
      price: 799,
      discountPrice: 599,
      stock: 85,
      flavors: [],
      weights: ['S', 'M', 'L', 'XL'],
      rating: 4.7,
      reviewCount: 78,
      isFeatured: true,
      isActive: true,
      images: [U('photo-1517836357463-d25dfeac3438')],
    },
    {
      name: 'Heavy Resistance Band Set (5-in-1)',
      category: 'accessories',
      brand: 'FitNation',
      description: 'Set of 5 color-coded 100% natural latex resistance loop bands from light to XXL heavy. Includes travel pouch and exercise guide.',
      price: 899,
      discountPrice: 649,
      stock: 70,
      flavors: [],
      weights: ['Set of 5'],
      rating: 4.8,
      reviewCount: 165,
      isFeatured: true,
      isActive: true,
      images: [U('photo-1584735935682-2f2b69dff9d2')],
    },
    {
      name: 'FitNation Stainless Steel Shaker Bottle 750ml',
      category: 'accessories',
      brand: 'FitNation',
      description: 'Insulated double-wall stainless steel shaker bottle. Leak-proof flip cap, measurement markings, and wire mixing ball.',
      price: 699,
      discountPrice: 499,
      stock: 120,
      flavors: ['Matte Black', 'Silver Metallic', 'Army Green'],
      weights: ['750ml'],
      rating: 4.9,
      reviewCount: 210,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1602143407151-7111542de6e8')],
    },
    {
      name: 'FitNation Dri-Fit Performance Training Tee',
      category: 'apparel',
      brand: 'FitNation',
      description: 'Ultra-lightweight 4-way stretch moisture wicking training t-shirt. Keeps you cool, dry, and mobile through your heaviest sessions.',
      price: 999,
      discountPrice: 799,
      stock: 80,
      flavors: ['Onyx Black', 'Navy Blue', 'Heather Grey', 'Crimson Red'],
      weights: ['S', 'M', 'L', 'XL', 'XXL'],
      rating: 4.5,
      reviewCount: 88,
      isFeatured: false,
      isActive: true,
      images: [U('photo-1521572267360-ee0c2909d518')],
    },
  ]);
  console.log(`✅ Seeded ${products.length} products`);

  // ─────────────────────────────────────────────
  // 8. DIET PLANS
  // ─────────────────────────────────────────────
  await DietPlan.deleteMany({});
  await DietPlan.insertMany([
    {
      title: 'High Protein Muscle Hypertrophy Plan',
      goal: 'muscle-gain',
      description: 'Nutrient-dense 3,000 calorie diet calibrated for lean muscle tissue growth with balanced macro splits.',
      totalCalories: 3000,
      totalProtein: '185g',
      image: U('photo-1512621776951-a57141f2eefd'),
      isPublic: true,
      uploadedBy: admin._id,
      assignedTo: [members[0]._id, members[2]._id],
      meals: [
        {
          mealType: 'breakfast',
          time: '7:30 AM',
          notes: 'High complex carbs with quality protein to fuel morning training',
          items: [
            { name: 'Rolled Oats with Almond Milk', quantity: '100g', calories: 380, protein: '13g', carbs: '68g', fat: '7g' },
            { name: 'Whole Eggs (Boiled/Scrambled)', quantity: '4 eggs', calories: 280, protein: '24g', carbs: '2g', fat: '20g' },
            { name: 'Banana & Handful Almonds', quantity: '1 medium + 15g', calories: 200, protein: '4g', carbs: '32g', fat: '8g' },
          ]
        },
        {
          mealType: 'pre-workout',
          time: '11:00 AM',
          notes: 'Easily digestible carbohydrates 45 mins prior to workout',
          items: [
            { name: 'Brown Bread with Peanut Butter', quantity: '2 slices + 2 tbsp', calories: 320, protein: '12g', carbs: '35g', fat: '16g' },
            { name: 'Black Coffee with Honey', quantity: '1 mug', calories: 40, protein: '0g', carbs: '10g', fat: '0g' },
          ]
        },
        {
          mealType: 'post-workout',
          time: '1:30 PM',
          notes: 'Rapid amino acid and glycogen replenishment window',
          items: [
            { name: 'Whey Protein Isolate Shake', quantity: '1 scoop (32g)', calories: 130, protein: '25g', carbs: '2g', fat: '1g' },
            { name: 'Steamed White Rice / Dextrose', quantity: '150g', calories: 200, protein: '4g', carbs: '44g', fat: '0g' },
          ]
        },
        {
          mealType: 'lunch',
          time: '2:30 PM',
          notes: 'Complete balanced macro lunch meal',
          items: [
            { name: 'Grilled Chicken Breast', quantity: '200g', calories: 330, protein: '62g', carbs: '0g', fat: '7g' },
            { name: 'Brown Rice / Whole Wheat Roti', quantity: '1.5 cups / 3 rotis', calories: 320, protein: '8g', carbs: '65g', fat: '3g' },
            { name: 'Green Salad with Olive Oil', quantity: '1 bowl', calories: 90, protein: '2g', carbs: '8g', fat: '6g' },
          ]
        },
        {
          mealType: 'snack',
          time: '5:30 PM',
          notes: 'Afternoon sustained energy booster',
          items: [
            { name: 'Greek Yogurt with Mixed Berries', quantity: '200g', calories: 150, protein: '18g', carbs: '14g', fat: '2g' },
            { name: 'Walnuts & Pumpkin Seeds', quantity: '25g', calories: 160, protein: '5g', carbs: '4g', fat: '15g' },
          ]
        },
        {
          mealType: 'dinner',
          time: '8:30 PM',
          notes: 'Slow-digesting protein sources to support overnight recovery',
          items: [
            { name: 'Fresh Paneer / Grilled Fish', quantity: '150g', calories: 300, protein: '26g', carbs: '6g', fat: '20g' },
            { name: 'Moong Dal / Mixed Lentil Soup', quantity: '1 large bowl', calories: 180, protein: '12g', carbs: '28g', fat: '2g' },
            { name: 'Steamed Vegetables', quantity: '1 bowl', calories: 70, protein: '3g', carbs: '12g', fat: '1g' },
          ]
        },
      ]
    },
    {
      title: 'Targeted Calorie Deficit Fat Loss Plan',
      goal: 'weight-loss',
      description: 'Satiating, fiber-rich, high-protein 1,700 calorie deficit plan to strip body fat while preserving lean muscle.',
      totalCalories: 1700,
      totalProtein: '155g',
      image: U('photo-1490645935967-10de6ba17061'),
      isPublic: true,
      uploadedBy: admin._id,
      assignedTo: [members[1]._id, members[4]._id],
      meals: [
        {
          mealType: 'breakfast',
          time: '8:00 AM',
          notes: 'High volume, low calorie morning start',
          items: [
            { name: 'Egg White Veggie Omelette', quantity: '6 whites + 1 whole', calories: 180, protein: '28g', carbs: '4g', fat: '5g' },
            { name: 'Multigrain Toast', quantity: '1 slice', calories: 80, protein: '3g', carbs: '14g', fat: '1g' },
            { name: 'Pure Green Tea', quantity: '1 cup', calories: 5, protein: '0g', carbs: '1g', fat: '0g' },
          ]
        },
        {
          mealType: 'snack',
          time: '11:00 AM',
          items: [
            { name: 'Crisp Green Apple', quantity: '1 medium', calories: 95, protein: '0g', carbs: '25g', fat: '0g' },
            { name: 'Almonds', quantity: '10 nuts', calories: 70, protein: '3g', carbs: '2g', fat: '6g' },
          ]
        },
        {
          mealType: 'lunch',
          time: '1:30 PM',
          items: [
            { name: 'Spiced Grilled Chicken or Tofu', quantity: '180g', calories: 280, protein: '48g', carbs: '2g', fat: '8g' },
            { name: 'Cooked Quinoa', quantity: '1 cup (150g)', calories: 180, protein: '6g', carbs: '32g', fat: '3g' },
            { name: 'Cucumber, Tomato & Lemon Salad', quantity: '1 large bowl', calories: 45, protein: '2g', carbs: '9g', fat: '0g' },
          ]
        },
        {
          mealType: 'pre-workout',
          time: '4:30 PM',
          items: [
            { name: 'Whey Protein in Water', quantity: '1 scoop', calories: 120, protein: '24g', carbs: '2g', fat: '1g' },
            { name: 'Black Espresso', quantity: '1 shot', calories: 5, protein: '0g', carbs: '1g', fat: '0g' },
          ]
        },
        {
          mealType: 'dinner',
          time: '8:00 PM',
          notes: 'Low glycemic, light evening meal before 8:30 PM',
          items: [
            { name: 'Herb Grilled Fish or Soya Chunks', quantity: '160g', calories: 220, protein: '36g', carbs: '4g', fat: '5g' },
            { name: 'Steamed Broccoli, Zucchini & Carrots', quantity: '1.5 bowls', calories: 90, protein: '5g', carbs: '16g', fat: '1g' },
            { name: 'Yellow Moong Soup', quantity: '1 small bowl', calories: 110, protein: '7g', carbs: '18g', fat: '1g' },
          ]
        },
      ]
    },
    {
      title: 'Vegetarian High Protein Power Plan',
      goal: 'muscle-gain',
      description: '100% vegetarian Indian meal plan packing 140g protein from paneer, soya chunks, Greek yogurt, and lentils.',
      totalCalories: 2300,
      totalProtein: '140g',
      image: U('photo-1498837167922-ddd27525d352'),
      isPublic: true,
      uploadedBy: trainers[1]._id,
      meals: [
        {
          mealType: 'breakfast',
          time: '8:00 AM',
          items: [
            { name: 'Paneer Bhurji with 2 Multigrain Rotis', quantity: '150g paneer + 2 rotis', calories: 440, protein: '26g', carbs: '38g', fat: '20g' },
            { name: 'Low Fat Fresh Curd', quantity: '150g', calories: 95, protein: '8g', carbs: '7g', fat: '4g' },
          ]
        },
        {
          mealType: 'snack',
          time: '11:00 AM',
          items: [
            { name: 'Boiled Chickpea / Sprouts Chaat', quantity: '1 bowl', calories: 190, protein: '11g', carbs: '32g', fat: '3g' },
            { name: 'Fresh Coconut Water', quantity: '250ml', calories: 45, protein: '1g', carbs: '10g', fat: '0g' },
          ]
        },
        {
          mealType: 'lunch',
          time: '1:30 PM',
          items: [
            { name: 'Soya Chunk Curry', quantity: '60g raw (150g cooked)', calories: 230, protein: '32g', carbs: '18g', fat: '2g' },
            { name: 'Brown Rice with Dal Tadka', quantity: '1 plate', calories: 360, protein: '14g', carbs: '64g', fat: '5g' },
            { name: 'Cucumber & Beetroot Salad', quantity: '1 plate', calories: 50, protein: '2g', carbs: '10g', fat: '0g' },
          ]
        },
        {
          mealType: 'snack',
          time: '5:30 PM',
          items: [
            { name: 'Roasted Chana with Green Tea', quantity: '50g', calories: 180, protein: '10g', carbs: '28g', fat: '3g' },
            { name: 'Peanut Butter Toast', quantity: '1 slice + 1 tbsp', calories: 170, protein: '6g', carbs: '18g', fat: '8g' },
          ]
        },
        {
          mealType: 'dinner',
          time: '8:30 PM',
          items: [
            { name: 'Tofu / Paneer Tikka with Grilled Bell Peppers', quantity: '180g', calories: 310, protein: '24g', carbs: '10g', fat: '18g' },
            { name: 'Palak Dal / Rajma Curry', quantity: '1 bowl', calories: 180, protein: '11g', carbs: '26g', fat: '3g' },
            { name: 'Warm Cow Milk with Turmeric', quantity: '200ml', calories: 120, protein: '7g', carbs: '10g', fat: '6g' },
          ]
        },
      ]
    },
    {
      title: 'Healthy Maintenance & Vitality Plan',
      goal: 'maintenance',
      description: 'Balanced 2,100 calorie daily plan for active individuals seeking sustained all-day energy and metabolic health.',
      totalCalories: 2100,
      totalProtein: '125g',
      image: U('photo-1467003909585-2f8a72700288'),
      isPublic: true,
      uploadedBy: trainers[0]._id,
      meals: [
        {
          mealType: 'breakfast',
          time: '8:00 AM',
          items: [
            { name: 'Vegetable Poha with Peanuts', quantity: '1 plate', calories: 320, protein: '8g', carbs: '54g', fat: '9g' },
            { name: 'Boiled Whole Eggs', quantity: '2 eggs', calories: 140, protein: '12g', carbs: '1g', fat: '10g' },
          ]
        },
        {
          mealType: 'lunch',
          time: '1:00 PM',
          items: [
            { name: 'Grilled Fish or Paneer Curry', quantity: '150g', calories: 310, protein: '28g', carbs: '8g', fat: '18g' },
            { name: 'Whole Wheat Phulkas', quantity: '3 pieces', calories: 240, protein: '8g', carbs: '48g', fat: '2g' },
            { name: 'Dal Fry with Mixed Veggies', quantity: '1 bowl', calories: 160, protein: '9g', carbs: '24g', fat: '4g' },
          ]
        },
        {
          mealType: 'snack',
          time: '5:00 PM',
          items: [
            { name: 'Fresh Fruit Medley (Papaya, Pomegranate)', quantity: '1 bowl', calories: 110, protein: '2g', carbs: '26g', fat: '0g' },
            { name: 'Mixed Roasted Seeds (Chia, Pumpkin)', quantity: '20g', calories: 110, protein: '5g', carbs: '4g', fat: '9g' },
          ]
        },
        {
          mealType: 'dinner',
          time: '8:30 PM',
          items: [
            { name: 'Chicken or Rajma Rice Bowl', quantity: '1 plate', calories: 480, protein: '34g', carbs: '62g', fat: '10g' },
            { name: 'Fresh Mint Raita', quantity: '1 small bowl', calories: 80, protein: '5g', carbs: '6g', fat: '3g' },
          ]
        },
      ]
    },
    {
      title: 'Beginner Clean Eating Starter Plan',
      goal: 'general',
      description: 'Simple, sustainable everyday meals with no rare ingredients, helping members build healthy dietary consistency.',
      totalCalories: 1950,
      totalProtein: '115g',
      image: U('photo-1546069901-ba9599a7e63c'),
      isPublic: true,
      uploadedBy: admin._id,
      meals: [
        {
          mealType: 'breakfast',
          time: '8:30 AM',
          items: [
            { name: 'Milk & Whole Grain Muesli', quantity: '1 bowl', calories: 320, protein: '12g', carbs: '52g', fat: '7g' },
            { name: 'Boiled Eggs', quantity: '2 eggs', calories: 140, protein: '12g', carbs: '1g', fat: '10g' },
          ]
        },
        {
          mealType: 'lunch',
          time: '1:30 PM',
          items: [
            { name: 'Homemade Roti, Dal, and Mixed Sabzi', quantity: '1 plate', calories: 480, protein: '18g', carbs: '72g', fat: '12g' },
            { name: 'Fresh Dahi (Curd)', quantity: '1 bowl', calories: 100, protein: '8g', carbs: '7g', fat: '4g' },
          ]
        },
        {
          mealType: 'snack',
          time: '5:00 PM',
          items: [
            { name: 'Chana / Roasted Peanuts with Tea', quantity: '40g', calories: 170, protein: '8g', carbs: '18g', fat: '8g' },
          ]
        },
        {
          mealType: 'dinner',
          time: '8:30 PM',
          items: [
            { name: 'Paneer or Egg Curry with Steamed Rice', quantity: '1 plate', calories: 510, protein: '26g', carbs: '60g', fat: '18g' },
            { name: 'Fresh Green Salad', quantity: '1 bowl', calories: 40, protein: '1g', carbs: '8g', fat: '0g' },
          ]
        },
      ]
    },
  ]);
  console.log('✅ Seeded 5 comprehensive diet plans');

  // ─────────────────────────────────────────────
  // 9. TRANSFORMATIONS (WITH MATCHING JOURNEY PHOTOS & VIDEOS)
  // ─────────────────────────────────────────────
  await Transformation.deleteMany({});
  await Transformation.insertMany([
    {
      member: members[0]._id,
      title: 'Aman\'s 14-Week Muscle Recomposition',
      description: 'From skinny to solid 8kg lean muscle gain following the Push Pull Legs split and the High Protein Hypertrophy diet.',
      beforeImage: U('photo-1552674605-db6ffd4facb5', 600),
      afterImage: U('photo-1583454110551-21f2fa2afe61', 600),
      videoUrl: yt('8iPEnn-ltC8'),
      duration: '14 weeks',
      weightLost: '',
      muscleGained: '8 kg lean muscle',
      isPublic: true,
      uploadedBy: admin._id,
    },
    {
      member: members[1]._id,
      title: 'Sneha\'s 16-Week Fat Loss & Transformation',
      description: 'Lost 13 kg of body fat, dropped 4 dress sizes, and dramatically boosted energy levels with Coach Priya\'s guidance.',
      beforeImage: U('photo-1518310383802-640c2de311b6', 600),
      afterImage: U('photo-1574680096145-d05b474e2155', 600),
      videoUrl: yt('pPn3i5k_84w'),
      duration: '16 weeks',
      weightLost: '13 kg body fat',
      muscleGained: '2 kg lean tone',
      isPublic: true,
      uploadedBy: admin._id,
    },
    {
      member: members[2]._id,
      title: 'Rohit\'s Total Strength Transformation',
      description: 'Squat increased from 70kg to 140kg; bench reached 100kg. Shed 6kg of visceral fat while building a dense athletic physique.',
      beforeImage: U('photo-1540474252-71ebe7aed77b', 600),
      afterImage: U('photo-1526506118085-60ce8714f8c5', 600),
      videoUrl: yt('op9kVnSso6Q'),
      duration: '6 months',
      weightLost: '6 kg fat',
      muscleGained: '7 kg muscle',
      isPublic: true,
      uploadedBy: trainers[0]._id,
    },
    {
      member: members[3]._id,
      title: 'Neha\'s Journey: From Zero Activity to 10k Finisher',
      description: 'Reversed chronic lethargy, completed her first official 10k run, and dropped 9kg through consistent gym habits.',
      beforeImage: U('photo-1544367567-0f2fcb009e0b', 600),
      afterImage: U('photo-1594381898411-846e7d193883', 600),
      videoUrl: yt('u3zgHI8YCyo'),
      duration: '5 months',
      weightLost: '9 kg',
      muscleGained: '2.5 kg lean tone',
      isPublic: true,
      uploadedBy: trainers[1]._id,
    },
    {
      member: members[6]._id,
      title: 'Sanjay\'s 90-Day Athletic Shred',
      description: 'Reduced body fat percentage from 24% to 14% in 90 days following our structured metabolic circuits and clean diet.',
      beforeImage: U('photo-1600180758890-6b94519a8ba6', 600),
      afterImage: U('photo-1581009146145-b5ef050c2e1e', 600),
      videoUrl: yt('rT7DgCr-3pg'),
      duration: '90 days',
      weightLost: '8.5 kg fat',
      muscleGained: '3.5 kg muscle',
      isPublic: true,
      uploadedBy: admin._id,
    },
    {
      member: members[7]._id,
      title: 'Ankita\'s Post-Pregnancy Strength Return',
      description: 'Rebuilt deep core strength, eliminated lower back discomfort, and lost 11 kg in 6 months with progressive strength training.',
      beforeImage: U('photo-1584464491033-06628f3a6b7b', 600),
      afterImage: U('photo-1541534741688-6078c6bfb5c5', 600),
      videoUrl: yt('QOVaHwm-Q6U'),
      duration: '6 months',
      weightLost: '11 kg',
      muscleGained: '3 kg lean mass',
      isPublic: true,
      uploadedBy: trainers[1]._id,
    },
  ]);
  console.log('✅ Seeded 6 realistic member transformations');

  // ─────────────────────────────────────────────
  // 10. PROGRESS ENTRIES
  // ─────────────────────────────────────────────
  await ProgressEntry.deleteMany({});
  const progressData = [];
  const trackedMembers = [
    { member: members[0]._id, weight: 78, bodyFat: 18, chest: 98, waist: 84, hips: 96, arms: 35, thighs: 58 },
    { member: members[1]._id, weight: 68, bodyFat: 26, chest: 90, waist: 79, hips: 101, arms: 28, thighs: 62 },
    { member: members[2]._id, weight: 86, bodyFat: 21, chest: 103, waist: 89, hips: 99, arms: 38, thighs: 61 },
    { member: members[3]._id, weight: 63, bodyFat: 23, chest: 87, waist: 73, hips: 95, arms: 26, thighs: 58 },
  ];
  trackedMembers.forEach(({ member, weight, bodyFat, chest, waist, hips, arms, thighs }) => {
    for (let i = 4; i >= 0; i--) {
      const delta = (4 - i) * 0.6;
      progressData.push({
        member,
        date: past(i * 28),
        weight: +(weight - delta * 0.9).toFixed(1),
        bodyFat: +(bodyFat - delta * 0.5).toFixed(1),
        chest:  +(chest  + delta * 0.4).toFixed(1),
        waist:  +(waist  - delta * 0.6).toFixed(1),
        hips:   +(hips   - delta * 0.3).toFixed(1),
        arms:   +(arms   + delta * 0.3).toFixed(1),
        thighs: +(thighs - delta * 0.2).toFixed(1),
        notes: i === 0 ? 'Consistent adherence to training and calorie targets!' : `Monthly check-in log ${4 - i}`,
      });
    }
  });
  await ProgressEntry.insertMany(progressData);
  console.log(`✅ Seeded ${progressData.length} member progress tracking entries`);

  // ─────────────────────────────────────────────
  // 11. NOTIFICATIONS
  // ─────────────────────────────────────────────
  await Notification.deleteMany({});
  await Notification.insertMany([
    { member: members[0]._id, type: 'general',         title: 'Welcome to FitNation!',          message: 'Welcome Aman! Your membership is active. Gym floor is open 6:00 AM to 10:00 PM daily.',  isRead: true,  sentVia: ['website'] },
    { member: members[1]._id, type: 'diet-assigned',   title: 'New Diet Plan Assigned',          message: 'Coach Priya has updated your Fat Loss Meal Plan. Check your nutrition dashboard!',       isRead: false, sentVia: ['website', 'whatsapp'] },
    { member: members[2]._id, type: 'general',         title: 'Push Pull Legs Split Active',     message: 'Your custom PPL workout split has been loaded by Coach Rahul.',                           isRead: false, sentVia: ['website'] },
    { member: members[4]._id, type: 'fee-reminder',    title: 'Membership Renewal Due',          message: 'Hi Vikas, your monthly membership fee of ₹1,500 is due in 2 days. Renew seamlessly online.', isRead: false, sentVia: ['website', 'whatsapp'] },
    { member: members[5]._id, type: 'membership-expired', title: 'Membership Grace Period',     message: 'Hi Divya, your plan expired 10 days ago. Renew today to maintain your trainer support.',  isRead: false, sentVia: ['website', 'whatsapp'] },
    { member: members[6]._id, type: 'exercise-assigned', title: 'New Exercise Video Added',      message: 'Coach Rahul added Cable Chest Fly and Deadlift instructions to your weekly split.',        isRead: true,  sentVia: ['website'] },
    { member: members[7]._id, type: 'general',         title: 'Gym Holiday Notice',              message: 'FitNation will remain closed on Sunday for facility deep maintenance. Reopening Monday 6 AM.', isRead: false, sentVia: ['website'] },
    { member: members[8]._id, type: 'diet-assigned',   title: 'Bulking Nutrition Guide Ready',   message: 'Your customized 3,000 calorie diet plan has been prepared. Track your daily macros.',    isRead: true,  sentVia: ['website'] },
    { member: members[3]._id, type: 'fee-reminder',    title: 'Yearly Plan Renewal in 7 Days',   message: 'Your annual plan renews next week. Save 15% on early renewal at the front desk.',         isRead: true,  sentVia: ['website', 'whatsapp'] },
    { member: members[9]._id, type: 'general',         title: 'New Supplements Now in Stock',    message: 'Gold Standard Whey, Platinum Creatine, and C4 Pre-Workout have arrived with exclusive member pricing.', isRead: false, sentVia: ['website'] },
  ]);
  console.log('✅ Seeded 10 realistic notifications');

  // ─────────────────────────────────────────────
  // 12. STORE ORDERS
  // ─────────────────────────────────────────────
  await Order.deleteMany({});
  const allProds = await Product.find({});
  const findP = (str) => allProds.find(p => p.name.toLowerCase().includes(str.toLowerCase())) || allProds[0];

  const pWhey = findP('Gold Standard');
  const pCreatine = findP('Creatine');
  const pC4 = findP('C4');
  const pBands = findP('Resistance Band');
  const pShaker = findP('Shaker');
  const pFishOil = findP('Fish Oil');
  const pMulti = findP('Multivitamin');

  const orders = await Order.insertMany([
    {
      user: members[0]._id,
      items: [{ product: pWhey._id, name: pWhey.name, price: pWhey.discountPrice || pWhey.price, quantity: 1, flavor: 'Double Rich Chocolate', weight: '2kg', image: pWhey.images[0] }],
      shippingAddress: { name: 'Aman Gupta', phone: '9111111111', address: '12 Saket Nagar', city: 'Rajgarh', state: 'Madhya Pradesh', pincode: '454116' },
      totalAmount: pWhey.discountPrice || pWhey.price,
      paymentMethod: 'online', paymentStatus: 'paid', orderStatus: 'delivered',
      createdAt: past(12)
    },
    {
      user: members[1]._id,
      items: [
        { product: pC4._id, name: pC4.name, price: pC4.discountPrice || pC4.price, quantity: 1, flavor: 'Fruit Punch', weight: '30 Servings', image: pC4.images[0] },
        { product: pShaker._id, name: pShaker.name, price: pShaker.discountPrice || pShaker.price, quantity: 1, flavor: 'Matte Black', weight: '750ml', image: pShaker.images[0] },
      ],
      shippingAddress: { name: 'Sneha Patil', phone: '9111111112', address: '45 Station Road', city: 'Rajgarh', state: 'Madhya Pradesh', pincode: '454116' },
      totalAmount: (pC4.discountPrice || pC4.price) + (pShaker.discountPrice || pShaker.price),
      paymentMethod: 'upi', paymentStatus: 'paid', orderStatus: 'processing',
      createdAt: past(5)
    },
    {
      user: members[2]._id,
      items: [{ product: pCreatine._id, name: pCreatine.name, price: pCreatine.discountPrice || pCreatine.price, quantity: 2, flavor: 'Unflavoured', weight: '250g', image: pCreatine.images[0] }],
      shippingAddress: { name: 'Rohit Joshi', phone: '9111111113', address: '78 Main Market', city: 'Rajgarh', state: 'Madhya Pradesh', pincode: '454116' },
      totalAmount: (pCreatine.discountPrice || pCreatine.price) * 2,
      paymentMethod: 'cod', paymentStatus: 'pending', orderStatus: 'confirmed',
      createdAt: past(2)
    },
    {
      user: members[3]._id,
      items: [
        { product: pFishOil._id, name: pFishOil.name, price: pFishOil.discountPrice || pFishOil.price, quantity: 1, flavor: '', weight: '60 Softgels', image: pFishOil.images[0] },
        { product: pMulti._id, name: pMulti.name, price: pMulti.discountPrice || pMulti.price, quantity: 1, flavor: '', weight: '60 Tablets', image: pMulti.images[0] },
      ],
      shippingAddress: { name: 'Neha Singh', phone: '9111111114', address: '23 Anand Colony', city: 'Rajgarh', state: 'Madhya Pradesh', pincode: '454116' },
      totalAmount: (pFishOil.discountPrice || pFishOil.price) + (pMulti.discountPrice || pMulti.price),
      paymentMethod: 'online', paymentStatus: 'paid', orderStatus: 'placed',
      createdAt: past(1)
    },
    {
      user: members[6]._id,
      items: [{ product: pBands._id, name: pBands.name, price: pBands.discountPrice || pBands.price, quantity: 1, weight: 'Set of 5', image: pBands.images[0] }],
      shippingAddress: { name: 'Sanjay Patel', phone: '9111111117', address: '55 Civil Lines', city: 'Rajgarh', state: 'Madhya Pradesh', pincode: '454116' },
      totalAmount: pBands.discountPrice || pBands.price,
      paymentMethod: 'cod', paymentStatus: 'pending', orderStatus: 'placed',
      createdAt: now
    },
  ]);
  console.log(`✅ Seeded ${orders.length} store orders`);

  // ─────────────────────────────────────────────
  // 13. PAYMENTS & REVENUE
  // ─────────────────────────────────────────────
  await Payment.deleteMany({});
  const paymentsData = [];

  // Membership fee payments from active members
  members.filter(m => m.feePaid).forEach((m, idx) => {
    paymentsData.push({
      member: m._id,
      source: 'membership',
      kind: 'new-membership',
      amount: m.feeAmount,
      method: ['upi', 'cash', 'card', 'online'][idx % 4],
      periodStart: m.membershipStart,
      periodEnd: m.membershipEnd,
      recordedBy: admin._id,
      note: `Membership fee for ${m.membershipPlan} plan`,
      createdAt: m.membershipStart,
    });
  });

  // Store payments from paid orders
  orders.filter(o => o.paymentStatus === 'paid').forEach((o) => {
    paymentsData.push({
      member: o.user,
      source: 'store',
      kind: 'order',
      amount: o.totalAmount,
      method: o.paymentMethod,
      order: o._id,
      recordedBy: admin._id,
      note: `Store purchase #${o._id.toString().slice(-6)}`,
      createdAt: o.createdAt,
    });
  });

  await Payment.insertMany(paymentsData);
  console.log(`✅ Seeded ${paymentsData.length} ledger payments`);

  // ─────────────────────────────────────────────
  // 14. ENQUIRIES (LEADS)
  // ─────────────────────────────────────────────
  await Enquiry.deleteMany({});
  await Enquiry.insertMany([
    { name: 'Rahul Kapoor',   phone: '9800000001', email: 'rahul.k@gmail.com',   message: 'Interested in joining this week. What are the morning batch timings?',                               interest: 'membership',         status: 'new',       createdAt: past(1) },
    { name: 'Prachi Desai',   phone: '9800000002', email: 'prachi.d@gmail.com',   message: 'Looking for a female personal trainer for postpartum weight loss. Please share package details.',     interest: 'personal-training',  status: 'contacted', notes: 'Spoke over phone. Scheduled gym tour on Friday.', createdAt: past(3) },
    { name: 'Akash Mehta',    phone: '9800000003', email: 'akash.m@gmail.com',    message: 'Need a structured muscle gain diet plan and body composition scan.',                                 interest: 'diet-plan',          status: 'converted', notes: 'Signed up for Half-Yearly plan.', createdAt: past(7) },
    { name: 'Simran Kaur',    phone: '9800000004', email: 'simran.k@gmail.com',   message: 'Do you offer couples discounts on yearly memberships?',                                              interest: 'membership',         status: 'contacted', notes: 'Sent brochure on WhatsApp.', createdAt: past(4) },
    { name: 'Raj Malhotra',   phone: '9800000005', email: 'raj.m@gmail.com',      message: 'What parking facilities are available for four wheelers near the gym?',                              interest: 'general',            status: 'contacted', notes: 'Informed about front designated parking.', createdAt: past(6) },
    { name: 'Kavya Reddy',    phone: '9800000006', email: 'kavya.r@gmail.com',    message: 'I am a complete beginner with no weightlifting experience. Is trainer guidance included initially?',interest: 'membership',         status: 'new',       createdAt: past(2) },
    { name: 'Nikhil Sharma',  phone: '9800000007', email: 'nikhil.s@gmail.com',   message: 'Looking for student discount options for college students.',                                         interest: 'membership',         status: 'closed',    notes: 'Informed student plan requires valid ID.', createdAt: past(10) },
    { name: 'Tanya Gupta',    phone: '9800000008', email: 'tanya.g@gmail.com',    message: 'Do you have dedicated women-only workout hours in the morning or evening?',                          interest: 'personal-training',  status: 'new',       createdAt: past(1) },
  ]);
  console.log('✅ Seeded 8 prospective member enquiries');

  console.log('\n🎉 ALL DEMO DATA SEEDED INTO DATABASE SUCCESSFULLY!');
  console.log('──────────────────────────────────────────────────────');
  console.log('Admin account:  admin@fitnation.com (Ajeet Jamadari)');
  console.log('Trainer account: rahul@fitnation.com / trainer123');
  console.log('Member account:  aman@gmail.com      / member123');
  console.log('──────────────────────────────────────────────────────\n');

  await mongoose.disconnect();
  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Error during seeding:', err);
  process.exit(1);
});
