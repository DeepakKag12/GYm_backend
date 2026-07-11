require('dotenv').config();
const mongoose = require('mongoose');
const Exercise = require('./models/Exercise');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected');

  // Ensure admin exists
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    admin = await User.create({
      name: 'Ajeet Singh', email: 'admin@fitnation.com',
      phone: '9999999999', password: await bcrypt.hash('admin123', 10),
      role: 'admin'
    });
    console.log('Admin created: admin@fitnation.com / admin123');
  }

  const exercises = [
    // Chest
    { title: 'Barbell Bench Press', muscleGroup: 'chest', difficulty: 'intermediate', description: 'Lie flat on a bench, grip barbell slightly wider than shoulder-width. Lower to chest and press up explosively.', sets: 4, reps: '8-10', isPublic: true },
    { title: 'Incline Dumbbell Press', muscleGroup: 'chest', difficulty: 'intermediate', description: 'Set bench to 30-45°. Press dumbbells up from chest level, focusing on upper chest activation.', sets: 4, reps: '10-12', isPublic: true },
    { title: 'Cable Chest Fly', muscleGroup: 'chest', difficulty: 'beginner', description: 'Set cables at shoulder height, bring handles together in a hugging motion. Squeeze chest at peak.', sets: 3, reps: '12-15', isPublic: true },
    { title: 'Push-Up', muscleGroup: 'chest', difficulty: 'beginner', description: 'Classic bodyweight chest exercise. Keep core tight, lower chest to floor and push up.', sets: 3, reps: '15-20', isPublic: true },
    { title: 'Dips', muscleGroup: 'chest', difficulty: 'intermediate', description: 'Lean forward to target chest. Lower until shoulders are below elbows, then push up.', sets: 3, reps: '10-15', isPublic: true },

    // Back
    { title: 'Deadlift', muscleGroup: 'back', difficulty: 'advanced', description: 'Hip-hinge movement, maintain neutral spine. Drive through heels to lift the bar from floor to hip height.', sets: 4, reps: '5-6', isPublic: true },
    { title: 'Pull-Up', muscleGroup: 'back', difficulty: 'intermediate', description: 'Overhand grip, pull chest to bar. Full dead hang at bottom for full lat stretch.', sets: 4, reps: '6-10', isPublic: true },
    { title: 'Barbell Row', muscleGroup: 'back', difficulty: 'intermediate', description: 'Hinge at hips, pull barbell to lower chest. Squeeze shoulder blades together at top.', sets: 4, reps: '8-10', isPublic: true },
    { title: 'Lat Pulldown', muscleGroup: 'back', difficulty: 'beginner', description: 'Pull bar to upper chest, lean back slightly. Focus on driving elbows down to engage lats.', sets: 3, reps: '10-12', isPublic: true },
    { title: 'Seated Cable Row', muscleGroup: 'back', difficulty: 'beginner', description: 'Keep chest up, pull handle to lower abdomen. Hold 1 second at peak contraction.', sets: 3, reps: '12-15', isPublic: true },

    // Shoulders
    { title: 'Overhead Press', muscleGroup: 'shoulders', difficulty: 'intermediate', description: 'Standing or seated, press barbell from clavicle to overhead. Keep core braced throughout.', sets: 4, reps: '8-10', isPublic: true },
    { title: 'Lateral Raise', muscleGroup: 'shoulders', difficulty: 'beginner', description: 'Raise dumbbells to shoulder height with slight bend in elbows. Lean forward slightly for better tension.', sets: 4, reps: '12-15', isPublic: true },
    { title: 'Arnold Press', muscleGroup: 'shoulders', difficulty: 'intermediate', description: 'Start with palms facing you. Rotate out as you press overhead for full shoulder activation.', sets: 3, reps: '10-12', isPublic: true },
    { title: 'Face Pull', muscleGroup: 'shoulders', difficulty: 'beginner', description: 'Set cable at face height, pull to forehead with external rotation. Excellent for rear delts and rotator cuff.', sets: 3, reps: '15-20', isPublic: true },
    { title: 'Front Raise', muscleGroup: 'shoulders', difficulty: 'beginner', description: 'Raise dumbbells or plate to shoulder height directly in front. Alternate arms or together.', sets: 3, reps: '12-15', isPublic: true },

    // Arms
    { title: 'Barbell Bicep Curl', muscleGroup: 'arms', difficulty: 'beginner', description: 'Stand with barbell, elbows fixed to sides. Curl up fully and lower slowly for maximum tension.', sets: 4, reps: '10-12', isPublic: true },
    { title: 'Hammer Curl', muscleGroup: 'arms', difficulty: 'beginner', description: 'Neutral grip dumbbell curl. Targets brachialis and brachioradialis along with biceps.', sets: 3, reps: '12-15', isPublic: true },
    { title: 'Tricep Pushdown', muscleGroup: 'arms', difficulty: 'beginner', description: 'Keep elbows at sides, push rope or bar down until arms fully extend. Squeeze triceps at bottom.', sets: 4, reps: '12-15', isPublic: true },
    { title: 'Skull Crusher', muscleGroup: 'arms', difficulty: 'intermediate', description: 'Lie on bench, lower EZ-bar to forehead with elbows fixed. Extend arms fully, targeting tricep long head.', sets: 3, reps: '10-12', isPublic: true },
    { title: 'Concentration Curl', muscleGroup: 'arms', difficulty: 'beginner', description: 'Sit and brace elbow on inner thigh. Full range curl for peak bicep contraction.', sets: 3, reps: '12-15', isPublic: true },

    // Legs
    { title: 'Barbell Squat', muscleGroup: 'legs', difficulty: 'advanced', description: 'Bar on upper traps, squat until thighs parallel. Drive through heels, keep knees tracking toes.', sets: 4, reps: '6-8', isPublic: true },
    { title: 'Romanian Deadlift', muscleGroup: 'legs', difficulty: 'intermediate', description: 'Hip hinge with slight knee bend. Lower barbell down legs feeling hamstring stretch, then drive hips forward.', sets: 4, reps: '10-12', isPublic: true },
    { title: 'Leg Press', muscleGroup: 'legs', difficulty: 'beginner', description: 'Push platform away with full foot contact. Do not lock knees at top. Control the descent.', sets: 4, reps: '12-15', isPublic: true },
    { title: 'Lunges', muscleGroup: 'legs', difficulty: 'beginner', description: 'Step forward, lower back knee toward floor. Keep front shin vertical. Alternate legs each rep.', sets: 3, reps: '12 each', isPublic: true },
    { title: 'Leg Curl', muscleGroup: 'legs', difficulty: 'beginner', description: 'Lying or seated, curl weight toward glutes. Full stretch at bottom for full hamstring activation.', sets: 3, reps: '12-15', isPublic: true },

    // Core
    { title: 'Plank', muscleGroup: 'core', difficulty: 'beginner', description: 'Hold push-up position on forearms. Keep hips level with shoulders, brace like you\'re about to be punched.', sets: 3, reps: '30-60 sec', isPublic: true },
    { title: 'Cable Crunch', muscleGroup: 'core', difficulty: 'beginner', description: 'Kneel at cable, pull rope attachment toward floor. Round lower back to maximize rectus abdominis contraction.', sets: 3, reps: '15-20', isPublic: true },
    { title: 'Hanging Leg Raise', muscleGroup: 'core', difficulty: 'intermediate', description: 'Hang from bar, raise legs to 90° or higher. Control descent to avoid hip flexor dominance.', sets: 3, reps: '12-15', isPublic: true },
    { title: 'Ab Wheel Rollout', muscleGroup: 'core', difficulty: 'advanced', description: 'Roll wheel forward from kneeling, extend as far as possible. Brace hard and pull back with lats and abs.', sets: 3, reps: '8-12', isPublic: true },
    { title: 'Russian Twist', muscleGroup: 'core', difficulty: 'beginner', description: 'Seated with feet off floor, rotate torso side to side holding a plate or dumbbell.', sets: 3, reps: '20 total', isPublic: true },

    // Cardio
    { title: 'Treadmill HIIT', muscleGroup: 'cardio', difficulty: 'intermediate', description: '30 sec sprint at 90% max HR then 60 sec walk. Repeat 8-10 rounds for maximum fat burn.', sets: 8, reps: '30 sec on / 60 sec off', isPublic: true },
    { title: 'Jump Rope', muscleGroup: 'cardio', difficulty: 'beginner', description: 'Skip rope continuously for 60 seconds intervals. Great for coordination, calves, and cardiovascular endurance.', sets: 5, reps: '60 sec', isPublic: true },
    { title: 'Battle Ropes', muscleGroup: 'cardio', difficulty: 'intermediate', description: 'Alternate arm waves for 30 seconds, rest 30. Total body metabolic conditioning.', sets: 6, reps: '30 sec', isPublic: true },
    { title: 'Box Jump', muscleGroup: 'cardio', difficulty: 'intermediate', description: 'Explosive jump onto plyo box. Land softly, step down, reset. Focus on explosive power output.', sets: 4, reps: '8-10', isPublic: true },
    { title: 'Rowing Machine', muscleGroup: 'cardio', difficulty: 'beginner', description: 'Set damper to 4-6. Drive with legs first, then lean back, then pull. Reverse order on return stroke.', sets: 1, reps: '10-20 min', isPublic: true },

    // Full Body
    { title: 'Clean and Press', muscleGroup: 'fullbody', difficulty: 'advanced', description: 'Power clean barbell to shoulders, then overhead press. Full-body explosive compound movement.', sets: 4, reps: '5-6', isPublic: true },
    { title: 'Burpee', muscleGroup: 'fullbody', difficulty: 'intermediate', description: 'Drop to push-up, perform push-up, jump feet to hands, then explode upward into a jump. No rest between reps.', sets: 4, reps: '10-15', isPublic: true },
    { title: 'Kettlebell Swing', muscleGroup: 'fullbody', difficulty: 'beginner', description: 'Hip hinge, swing kettlebell between legs then drive hips forward. The bell floats to shoulder height with momentum.', sets: 4, reps: '15-20', isPublic: true },
    { title: 'Thrusters', muscleGroup: 'fullbody', difficulty: 'intermediate', description: 'Front squat to overhead press in one fluid motion. Brutal metabolic and strength movement used in CrossFit.', sets: 4, reps: '8-10', isPublic: true },
    { title: 'Turkish Get-Up', muscleGroup: 'fullbody', difficulty: 'advanced', description: 'From lying with one arm extended holding weight, stand up while keeping weight overhead. Reverse to return.', sets: 3, reps: '3-5 each', isPublic: true },
  ];

  // Attach admin as creator
  const withCreator = exercises.map(e => ({ ...e, createdBy: admin._id }));

  await Exercise.deleteMany({}); // clear old
  await Exercise.insertMany(withCreator);
  console.log(`✅ Seeded ${withCreator.length} exercises`);
  process.exit(0);
};

seed().catch(err => { console.error(err); process.exit(1); });
