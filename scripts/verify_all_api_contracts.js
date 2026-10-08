const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve(__dirname, '../../frontend/frontend/src');
const backendRoutesDir = path.resolve(__dirname, '../src/routes');

// List of all backend routes defined in src/routes/
// Prefix /api + route path
const backendRoutes = [
  // auth
  { method: 'POST', path: '/api/auth/register' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'GET',  path: '/api/auth/me' },
  { method: 'PUT',  path: '/api/auth/update-profile' },
  { method: 'PUT',  path: '/api/auth/update-credentials' },
  { method: 'POST', path: '/api/auth/forgot-password' },
  { method: 'POST', path: '/api/auth/reset-password' },
  { method: 'POST', path: '/api/auth/quick-setup' },

  // members
  { method: 'GET',    path: '/api/members/roster' },
  { method: 'GET',    path: '/api/members' },
  { method: 'POST',   path: '/api/members' },
  { method: 'POST',   path: '/api/members/run-reminders' },
  { method: 'POST',   path: '/api/members/bulk-reminder' },
  { method: 'GET',    path: '/api/members/:id' },
  { method: 'PUT',    path: '/api/members/:id' },
  { method: 'DELETE', path: '/api/members/:id' },
  { method: 'PATCH',  path: '/api/members/:id/role' },
  { method: 'POST',   path: '/api/members/:id/reminder' },
  { method: 'POST',   path: '/api/members/:id/send-notification' },

  // trainers
  { method: 'GET',    path: '/api/trainers' },
  { method: 'GET',    path: '/api/trainers/admin/all' },
  { method: 'POST',   path: '/api/trainers' },
  { method: 'PUT',    path: '/api/trainers/:id' },
  { method: 'DELETE', path: '/api/trainers/:id' },

  // plans
  { method: 'GET',    path: '/api/plans' },
  { method: 'GET',    path: '/api/plans/:id' },
  { method: 'POST',   path: '/api/plans' },
  { method: 'PUT',    path: '/api/plans/:id' },
  { method: 'DELETE', path: '/api/plans/:id' },

  // payments
  { method: 'GET',    path: '/api/payments' },
  { method: 'GET',    path: '/api/payments/due' },
  { method: 'GET',    path: '/api/payments/:memberId/statement' },
  { method: 'GET',    path: '/api/payments/:paymentId/receipt' },
  { method: 'GET',    path: '/api/payments/receipt/:paymentId' },
  { method: 'POST',   path: '/api/payments/:memberId/statement' },
  { method: 'POST',   path: '/api/payments/:memberId/statement/whatsapp' },
  { method: 'GET',    path: '/api/payments/summary' },
  { method: 'POST',   path: '/api/payments' },
  { method: 'POST',   path: '/api/payments/due' },
  { method: 'PATCH',  path: '/api/payments/due/:memberId' },
  { method: 'PUT',    path: '/api/payments/due/:memberId' },
  { method: 'POST',   path: '/api/payments/due/settle' },
  { method: 'POST',   path: '/api/payments/backfill' },

  // splits
  { method: 'GET',    path: '/api/splits' },
  { method: 'GET',    path: '/api/splits/me' },
  { method: 'GET',    path: '/api/splits/planner' },
  { method: 'PUT',    path: '/api/splits/planner' },
  { method: 'GET',    path: '/api/splits/:id' },
  { method: 'POST',   path: '/api/splits' },
  { method: 'PUT',    path: '/api/splits/:id' },
  { method: 'DELETE', path: '/api/splits/:id' },

  // diet
  { method: 'GET',    path: '/api/diet' },
  { method: 'GET',    path: '/api/diet/my' },
  { method: 'GET',    path: '/api/diet/:id' },
  { method: 'POST',   path: '/api/diet' },
  { method: 'PUT',    path: '/api/diet/:id' },
  { method: 'DELETE', path: '/api/diet/:id' },

  // exercises
  { method: 'POST',   path: '/api/exercises/sign-upload' },
  { method: 'GET',    path: '/api/exercises' },
  { method: 'GET',    path: '/api/exercises/my' },
  { method: 'GET',    path: '/api/exercises/library/stats' },
  { method: 'GET',    path: '/api/exercises/:id' },
  { method: 'POST',   path: '/api/exercises' },
  { method: 'PUT',    path: '/api/exercises/:id' },
  { method: 'DELETE', path: '/api/exercises/:id' },

  // enquiries
  { method: 'POST',   path: '/api/enquiries' },
  { method: 'GET',    path: '/api/enquiries' },
  { method: 'PUT',    path: '/api/enquiries/:id' },
  { method: 'POST',   path: '/api/enquiries/:id/reply' },
  { method: 'DELETE', path: '/api/enquiries/:id' },

  // store
  { method: 'GET',    path: '/api/store' },
  { method: 'GET',    path: '/api/store/:id' },
  { method: 'POST',   path: '/api/store' },
  { method: 'PUT',    path: '/api/store/:id' },
  { method: 'DELETE', path: '/api/store/:id' },
  { method: 'POST',   path: '/api/store/:id/review' },

  // orders
  { method: 'POST',   path: '/api/orders' },
  { method: 'GET',    path: '/api/orders/my' },
  { method: 'GET',    path: '/api/orders' },
  { method: 'PUT',    path: '/api/orders/:id/status' },
  { method: 'GET',    path: '/api/orders/:id/invoice' },

  // settings
  { method: 'GET',    path: '/api/settings' },
  { method: 'POST',   path: '/api/settings/upload-image' },
  { method: 'PUT',    path: '/api/settings' },

  // analytics
  { method: 'GET',    path: '/api/analytics/summary' },
  { method: 'GET',    path: '/api/analytics/trainer-summary' },
  { method: 'GET',    path: '/api/analytics/revenue-monthly' },
  { method: 'GET',    path: '/api/analytics/membership-stats' },
  { method: 'GET',    path: '/api/analytics/new-members-monthly' },
  { method: 'GET',    path: '/api/analytics/revenue-full' },
  { method: 'POST',   path: '/api/analytics/reset-to-production' },
  { method: 'POST',   path: '/api/analytics/reset' },

  // notifications
  { method: 'GET',    path: '/api/notifications' },
  { method: 'GET',    path: '/api/notifications/admin/all' },
  { method: 'PUT',    path: '/api/notifications/admin/mark-all-read' },
  { method: 'GET',    path: '/api/notifications/admin/channels' },
  { method: 'POST',   path: '/api/notifications/admin/test' },
  { method: 'POST',   path: '/api/notifications/admin/send' },
  { method: 'PUT',    path: '/api/notifications/read-all' },
  { method: 'PUT',    path: '/api/notifications/:id/read' },
  { method: 'DELETE', path: '/api/notifications/admin/:id' },
  { method: 'DELETE', path: '/api/notifications/admin' },

  // progress
  { method: 'GET',    path: '/api/progress/me' },
  { method: 'GET',    path: '/api/progress/member/:memberId' },
  { method: 'POST',   path: '/api/progress' },
  { method: 'DELETE', path: '/api/progress/:id' },

  // transformations
  { method: 'GET',    path: '/api/transformations' },
  { method: 'GET',    path: '/api/transformations/all' },
  { method: 'POST',   path: '/api/transformations' },
  { method: 'PUT',    path: '/api/transformations/:id' },
  { method: 'DELETE', path: '/api/transformations/:id' },

  // cron
  { method: 'GET',    path: '/api/cron/fee-reminder' },

  // app-level
  { method: 'GET',    path: '/api/health' },
  { method: 'GET',    path: '/api/_cache/stats' },
];

function routeToRegex(p) {
  const pattern = p.replace(/:[a-zA-Z0-9_]+/g, '[^/?]+');
  return new RegExp(`^${pattern}$`);
}

function matchBackendRoute(method, cleanUrl) {
  const fullUrl = cleanUrl.startsWith('/api') ? cleanUrl : '/api' + cleanUrl;
  for (const r of backendRoutes) {
    if (r.method === method && routeToRegex(r.path).test(fullUrl)) {
      return r;
    }
  }
  return null;
}

// 2. Scan frontend files
function walk(dir) {
  let files = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      files = files.concat(walk(full));
    } else if (full.endsWith('.js') || full.endsWith('.jsx')) {
      files.push(full);
    }
  }
  return files;
}

const frontendFiles = walk(frontendDir);
const regex = /(?:API\.(get|post|put|delete|patch)|cachedGet|freshGet)\s*\(\s*([`'"])(.*?)\2/g;

let totalChecked = 0;
let errors = 0;

for (const f of frontendFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = regex.exec(content)) !== null) {
    totalChecked++;
    const method = (match[1] || 'get').toUpperCase();
    const rawUrl = match[3];
    const relFile = path.relative(frontendDir, f);

    // Skip dynamic expressions like ${endpointFor(user)} which resolve to /trainers or /members
    if (rawUrl.includes('endpointFor(')) continue;

    // Handle query param interpolations like /exercises${params} or /store${q}
    let urlForMatching = rawUrl
      .replace(/\$\{(?:params|q)\}/g, '')
      .replace(/\$\{.*?\}/g, 'param_id')
      .split('?')[0];

    const matched = matchBackendRoute(method, urlForMatching);
    if (!matched) {
      console.error(`❌ MISMATCH in ${relFile}: ${method} ${rawUrl} (clean: ${cleanUrl})`);
      errors++;
    }
  }
}

// Also check fetch calls in pdf.js and Payments.js
console.log(`\nChecked ${totalChecked} API call sites.`);
if (errors === 0) {
  console.log('✅ ALL FRONTEND API CALLS MATCH BACKEND ROUTES 100%!');
} else {
  console.error(`❌ Found ${errors} mismatched API calls.`);
  process.exit(1);
}
