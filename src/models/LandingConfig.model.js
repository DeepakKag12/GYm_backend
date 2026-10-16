const mongoose = require('mongoose');

const landingConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'landing', unique: true, immutable: true },

  // Color Tokens & Theme Configuration (Oris Reference Blue/White by default)
  theme: {
    primaryColor: { type: String, default: '#3366E4' },
    secondaryColor: { type: String, default: '#15324D' },
    pageBackground: { type: String, default: '#FFFFFF' },
    footerBottom: { type: String, default: '#112B7A' },
    lightPeriwinkle: { type: String, default: '#B5C9F7' },
    mutedGray: { type: String, default: '#9AA3AF' },
    watermarkGray: { type: String, default: '#D1D6DE' },
    fontFamily: { type: String, default: 'DM Sans' },
    animationIntensity: { type: String, enum: ['full', 'reduced', 'off'], default: 'full' },
  },

  // Hero Section
  hero: {
    badge: { type: String, default: 'Rajgarh (Dhar) · FITNATION BY AJEET' },
    headline: { type: String, default: "Build a stronger you at Rajgarh's 4000 sq ft fitness hub" },
    subtext: { type: String, default: 'Uniting a Healthier World' },
    exploreCtaText: { type: String, default: 'Explore Programs' },
    joinCtaText: { type: String, default: 'Join Now' },
    socialProofCount: { type: String, default: '' }, // empty by default; if empty, renders socialProofText
    socialProofText: { type: String, default: 'Join the FITNATION community' },
    avatars: [
      {
        name: { type: String },
        role: { type: String },
        image: { type: String },
      },
    ],
    visualizer3DEnabled: { type: Boolean, default: true },
  },

  // About Section & 4 Verified Counters
  about: {
    tagline: { type: String, default: 'Who are we?' },
    statement: {
      type: String,
      default:
        'At FITNATION BY AJEET, our 4000 sq ft facility in Rajgarh (Dhar) is dedicated to authentic strength coaching, progressive overload, and an uncompromising standard of fitness for every member.',
    },
    stats: [
      {
        value: { type: String },
        label: { type: String },
      },
    ],
  },

  // The 8 Training Programs (from Gym Posters)
  programs: [
    {
      id: { type: String },
      title: { type: String },
      tag: { type: String },
      desc: { type: String },
      image: { type: String },
    },
  ],

  // 3 Featured Program Blocks (Section C Mapping: Title, 3 Pill Tags, Description, Image)
  featuredPrograms: [
    {
      title: { type: String },
      tags: [{ type: String }],
      description: { type: String },
      image: { type: String },
      bgColor: { type: String, default: '#15324D' },
    },
  ],

  // Parallax Interior Band
  parallax: {
    quote: {
      type: String,
      default:
        'At FITNATION BY AJEET, our 4,000 sq ft premier fitness hub at Fourlane Square, Tridalam Arcade, Rajgarh (Dhar) is engineered for serious athletic discipline. No excuses. Just progress.',
    },
    image: {
      type: String,
      default: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?q=80&w=2000&auto=format&fit=crop',
    },
  },

  // Member Results / Transformations (Empty by default -> Hides until admin uploads)
  memberResults: [
    {
      name: { type: String },
      caption: { type: String },
      photo: { type: String },
    },
  ],

  // Team Section (Starts with Owner Ajeet Kag)
  team: [
    {
      name: { type: String, default: 'Ajeet Kag' },
      role: { type: String, default: 'Founder & Head Coach' },
      experience: { type: String, default: 'Certified Strength Coach' },
      specialty: { type: String, default: 'Bodybuilding & Personal Training' },
      photo: {
        type: String,
        default: 'https://images.unsplash.com/photo-1567013127542-490d757e51fc?q=80&w=900&auto=format&fit=crop',
      },
    },
  ],

  // Operating Hours & Timings (Flyer 1)
  timings: {
    motto: { type: String, default: 'Discipline today, strength tomorrow' },
    morningSession: { type: String, default: '5:00 AM – 11:00 AM' },
    eveningSession: { type: String, default: '4:00 PM – 10:00 PM' },
    daysText: { type: String, default: 'Monday to Saturday' },
    sundayClosed: { type: String, default: 'Sunday Closed' },
    communityLine: { type: String, default: "Let's build a stronger community together" },
    missionLine: { type: String, default: 'Your fitness, our mission' },
    mandates: [
      { type: String, default: 'Proper gym shoes compulsory' },
      { type: String, default: 'Rerack your weights after use' },
      { type: String, default: 'Keep gym clean & hygienic' },
    ],
  },

  // Policies, Additional Rules & Etiquette (Flyers 2 & 3)
  policies: {
    header: { type: String, default: 'Respect the rules | Support the community | Achieve your goals' },
    coreCards: [
      {
        number: { type: String },
        title: { type: String },
        desc: { type: String },
      },
    ],
    additionalRules: [{ type: String }],
    additionalClosing: { type: String, default: 'No excuses. Just progress.' },
    etiquette: [{ type: String }],
    etiquetteClosing: { type: String, default: 'Respect the gym. Respect your goals.' },
  },

  // Cafe & Meals Coming Soon Band (Flyer 4)
  cafe: {
    isEnabled: { type: Boolean, default: true },
    headline: { type: String, default: 'Cafe & Meals: Coming Soon!' },
    subheadline: { type: String, default: 'Healthy fuel. Stronger you. Better everyday.' },
    badge: { type: String, default: 'Clean ingredients, 100% committed, real results' },
    slogan: { type: String, default: 'Eat fit. Train hard. Live strong.' },
    features: [{ type: String }],
  },

  // Membership Notices & Plans (Flyer 5)
  membership: {
    discontinuedNotice: { type: String, default: '6-month and 12-month memberships are now discontinued.' },
    advanceLine: { type: String, default: 'Fees must be paid in advance on Day 1' },
    plans: [
      {
        id: { type: String },
        name: { type: String },
        duration: { type: String },
        price: { type: Number },
        originalPrice: { type: Number },
        savingsBadge: { type: String },
        isPopular: { type: Boolean, default: false },
        features: [{ type: String }],
      },
    ],
  },

  // Section Visibility Toggles (Admin can hide/show any section)
  sectionVisibility: {
    hero: { type: Boolean, default: true },
    about: { type: Boolean, default: true },
    programs: { type: Boolean, default: true },
    featured: { type: Boolean, default: true },
    parallax: { type: Boolean, default: true },
    memberResults: { type: Boolean, default: true },
    team: { type: Boolean, default: true },
    memberships: { type: Boolean, default: true },
    timings: { type: Boolean, default: true },
    policies: { type: Boolean, default: true },
    cafe: { type: Boolean, default: true },
    joinForm: { type: Boolean, default: true },
  },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Singleton getter & default seeder
landingConfigSchema.statics.getConfig = async function () {
  const existing = await this.findOne({ key: 'landing' });
  if (existing) return existing;

  const defaultDoc = new this({
    key: 'landing',
    about: {
      tagline: 'Who are we?',
      statement:
        'At FITNATION BY AJEET, our 4000 sq ft facility in Rajgarh (Dhar) is dedicated to authentic strength coaching, progressive overload, and an uncompromising standard of fitness for every member.',
      stats: [
        { value: '4000+', label: 'Sq Ft Fitness Hub' },
        { value: '8', label: 'Training Programs' },
        { value: '6', label: 'Days a Week' },
        { value: '12', label: 'Training Hours Daily' },
      ],
    },
    team: [
      {
        name: 'Ajeet Kag',
        role: 'Founder & Head Coach',
        experience: 'Certified Strength Coach',
        specialty: 'Bodybuilding & Personal Training',
        photo: 'https://images.unsplash.com/photo-1567013127542-490d757e51fc?q=80&w=900&auto=format&fit=crop',
      },
    ],
    programs: [
      {
        id: 'weight-gain',
        title: 'Weight Gain Mastery',
        tag: 'Hypertrophy',
        desc: 'Caloric surplus nutrition guidance and progressive resistance protocols engineered to build lean muscular mass and functional power.',
        image: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=800&q=80',
      },
      {
        id: 'weight-loss',
        title: 'Effective Weight Loss',
        tag: 'Fat Loss',
        desc: 'Metabolic deficit workouts, high-output cardio conditioning, and sustainable nutrition plans for long-term body recomposition.',
        image: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&q=80',
      },
      {
        id: 'bodybuilding',
        title: 'Bodybuilding Excellence',
        tag: 'Aesthetic Symmetry',
        desc: 'Hypertrophy-focused training targeting complete muscle isolation, mechanical tension, and proportional physique development.',
        image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&q=80',
      },
      {
        id: 'mens-physique',
        title: "Men's Physique Focus",
        tag: 'V-Taper & Core',
        desc: 'Emphasis on broad shoulders, a tight tapered waistline, sculpted core definition, and aesthetic stage-ready presentation.',
        image: 'https://images.unsplash.com/photo-1532029837206-abbe2b7620e3?w=800&q=80',
      },
      {
        id: 'personal-training',
        title: 'Personal Training Expertise',
        tag: '1-on-1 Mentorship',
        desc: 'Direct personalized floor coaching, technique correction, and custom periodized programming tailored to your individual anatomy.',
        image: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=800&q=80',
      },
      {
        id: 'crossfit',
        title: 'CrossFit Powerhouse',
        tag: 'MetCon Waves',
        desc: 'High-intensity functional movements forging aerobic stamina, explosive speed, grip endurance, and dynamic athletic resilience.',
        image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
      },
      {
        id: 'contest-prep',
        title: 'Contest Preparation',
        tag: 'Peak Conditioning',
        desc: 'Comprehensive stage prep including conditioning, carb depletion and loading protocols, and precision posing routines.',
        image: 'https://images.unsplash.com/photo-1567013127542-490d757e51fc?w=800&q=80',
      },
      {
        id: 'inclusive-fitness',
        title: 'Inclusive Fitness for All',
        tag: 'All Levels',
        desc: 'Welcoming beginner to veteran athletes with scalable workouts, form fundamentals, and injury prevention standards.',
        image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
      },
    ],
    featuredPrograms: [
      {
        title: "Bodybuilding & Men's Physique with Contest Preparation",
        tags: ['Barbell Mastery', 'Dense Hypertrophy', 'Stage Ready'],
        description:
          'Heavy compound lifts structured across progressive overload waves to forge uncompromising muscular power and aesthetic symmetry.',
        image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&q=80',
        bgColor: '#15324D',
      },
      {
        title: 'Weight Loss & CrossFit Powerhouse',
        tags: ['Metabolic Engine', 'VO2 Max Surge', 'Rapid Fat Loss'],
        description:
          'Dynamic functional circuits, interval conditioning, and calorie-torching protocols built to sustain peak athletic output.',
        image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
        bgColor: '#3366E4',
      },
      {
        title: 'Personal Training & Weight Gain Mastery',
        tags: ['1-on-1 Coaching', 'Kinetic Assessment', 'Muscle Architecture'],
        description:
          'Custom load curves, individual biomechanical corrections, and tailored nutritional blueprints guided directly by Head Coach Ajeet Kag.',
        image: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=800&q=80',
        bgColor: '#15324D',
      },
    ],
    policies: {
      header: 'Respect the rules | Support the community | Achieve your goals',
      coreCards: [
        {
          number: '01',
          title: 'Fees must be paid in advance on Day 1',
          desc: 'Fee must be paid in advance on Day 1. No entry or training will be allowed without advance payment.',
        },
        {
          number: '02',
          title: 'Gym starts on your first day',
          desc: 'The day you come to the gym, your membership and training will start from that day. After that, you must continue as per your plan. You cannot skip and expect to carry forward days unless it is a genuine emergency.',
        },
        {
          number: '03',
          title: 'Only medical emergencies allow day extension',
          desc: 'Day extensions will be given strictly in case of a medical emergency. Business, festivals, personal work or any other reason will not be considered for day extension.',
        },
        {
          number: '04',
          title: 'No refunds, only transfer',
          desc: 'Fees are non-refundable. In case you are unable to continue, your membership can be transferred to someone else (as per gym policy). No cash refund will be issued.',
        },
      ],
      additionalRules: [
        'Be on time (late arrivals may not be accommodated in the workout plan)',
        'Bring your own towel',
        'Stay hydrated (own water bottle, no sharing)',
        'Wear proper gym shoes (clean, non-marking)',
        'Keep your belongings safe (gym not responsible for loss or unattended items)',
        'Minimum phone usage in the workout area',
      ],
      additionalClosing: 'No excuses. Just progress.',
      etiquette: [
        'Put your weights and equipment back',
        'Wipe down equipment after use',
        'Keep your clothing on (posing area only)',
        'Headphones on = do not disturb',
        'Do not socialise while occupying equipment',
      ],
      etiquetteClosing: 'Respect the gym. Respect your goals.',
    },
    cafe: {
      isEnabled: true,
      headline: 'Cafe & Meals: Coming Soon!',
      subheadline: 'Healthy fuel. Stronger you. Better everyday.',
      badge: 'Clean ingredients, 100% committed, real results',
      slogan: 'Eat fit. Train hard. Live strong.',
      features: [
        'High protein',
        'Nutritious & balanced',
        'Energy boost',
        'Tasty & healthy',
        'Made with care',
      ],
    },
    membership: {
      discontinuedNotice: '6-month and 12-month memberships are now discontinued.',
      advanceLine: 'Fees must be paid in advance on Day 1',
      plans: [
        {
          id: '1-month',
          name: '1 Month Membership',
          duration: '1 Month',
          price: 1500,
          originalPrice: 1500,
          savingsBadge: '',
          isPopular: false,
          features: [
            'Full access to 4000 sq ft facility',
            'Cardio & Strength floors',
            'Morning & Evening sessions',
            'Locker room & shower access',
          ],
        },
        {
          id: '3-months',
          name: '3 Months Membership',
          duration: '3 Months',
          price: 3600,
          originalPrice: 4500,
          savingsBadge: 'Save ₹900 · Best Value',
          isPopular: true,
          features: [
            'Full access to 4000 sq ft facility',
            'Cardio & Strength floors',
            'Free workout split review',
            'Priority coaching support',
            'Lock-in discounted rate',
          ],
        },
      ],
    },
  });

  return defaultDoc.save();
};

module.exports = mongoose.model('LandingConfig', landingConfigSchema);
