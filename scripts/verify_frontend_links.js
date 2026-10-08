const fs = require('fs');
const path = require('path');

const frontendSrc = path.resolve(__dirname, '../../frontend/frontend/src');

function getAllFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(getAllFiles(fullPath));
      }
    } else if (/\.(js|jsx)$/.test(file)) {
      results.push(fullPath);
    }
  }
  return results;
}

const declaredRoutes = [
  '/',
  '/about',
  '/exercises',
  '/exercises/:id',
  '/diet',
  '/store',
  '/store/:id',
  '/cart',
  '/checkout',
  '/transformations',
  '/enquiry',
  '/plans',
  '/demo',
  '/demo/flashlight',
  '/login',
  '/settings',
  '/notifications',
  '/dashboard',
  '/my-orders',
  '/my-progress',
  '/my-workout',
  '/my-planner',
  '/my-exercises',
  '/my-diet',
  '/trainer',
  '/admin',
  '/admin/users',
  '/admin/members',
  '/admin/exercises',
  '/admin/diet',
  '/admin/store',
  '/admin/transformations',
  '/admin/enquiries',
  '/admin/orders',
  '/admin/trainers',
  '/admin/analytics',
  '/admin/revenue',
  '/admin/plans',
  '/admin/splits',
  '/admin/notifications',
  '/admin/settings',
  '/admin/gym',
  '/admin/payments'
];

function routeMatches(target) {
  // Ignore external links, mailto, tel, hash links
  if (!target || target.startsWith('http') || target.startsWith('mailto:') || target.startsWith('tel:') || target.startsWith('#')) {
    return true;
  }
  // Remove query params and hashes
  const clean = target.split('?')[0].split('#')[0];
  if (!clean || clean === '') return true;

  return declaredRoutes.some(pattern => {
    if (pattern === clean) return true;
    if (pattern.includes(':')) {
      const pSegments = pattern.split('/');
      const cSegments = clean.split('/');
      if (pSegments.length !== cSegments.length) return false;
      return pSegments.every((seg, idx) => seg.startsWith(':') || seg === cSegments[idx]);
    }
    return false;
  });
}

const files = getAllFiles(frontendSrc);
let totalLinks = 0;
let errors = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');

  // Match to="/..."
  const toRegex = /\bto\s*=\s*['"](\/[^'"]*)['"]/g;
  let m;
  while ((m = toRegex.exec(content)) !== null) {
    totalLinks++;
    const link = m[1];
    if (!routeMatches(link)) {
      errors.push({ file: path.relative(frontendSrc, file), link });
    }
  }

  // Match to={`/...`}
  const toTplRegex = /\bto\s*=\s*\{`(\/[^`$]+)[`$]/g;
  while ((m = toTplRegex.exec(content)) !== null) {
    totalLinks++;
    const prefix = m[1];
    // Check if any declared route starts with this prefix
    const matches = declaredRoutes.some(r => r.startsWith(prefix) || prefix.startsWith(r.split(':')[0]));
    if (!matches) {
      errors.push({ file: path.relative(frontendSrc, file), link: prefix });
    }
  }

  // Match navigate('/...')
  const navRegex = /\bnavigate\s*\(\s*['"](\/[^'"]*)['"]/g;
  while ((m = navRegex.exec(content)) !== null) {
    totalLinks++;
    const link = m[1];
    if (!routeMatches(link)) {
      errors.push({ file: path.relative(frontendSrc, file), link });
    }
  }

  // Match navigate(`/...`)
  const navTplRegex = /\bnavigate\s*\(\s*`(\/[^`$]+)[`$]/g;
  while ((m = navTplRegex.exec(content)) !== null) {
    totalLinks++;
    const prefix = m[1];
    const matches = declaredRoutes.some(r => r.startsWith(prefix) || prefix.startsWith(r.split(':')[0]));
    if (!matches) {
      errors.push({ file: path.relative(frontendSrc, file), link: prefix });
    }
  }
}

console.log(`Audited ${totalLinks} static internal route links across frontend.`);
if (errors.length > 0) {
  console.error(`❌ Found ${errors.length} broken internal navigation targets:`);
  errors.forEach(e => console.error(`  - In ${e.file}: ${e.link}`));
  process.exit(1);
} else {
  console.log(`✅ ALL FRONTEND INTERNAL NAVIGATION ROUTES ARE VALID!`);
}
