const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve(__dirname, '../../frontend/frontend/src');
const backendRoutesDir = path.resolve(__dirname, '../src/routes');

// 1. Collect all frontend API calls
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
const calls = [];

// Patterns for API calls
// e.g. API.get('/...', API.post('/...', cachedGet('/...', freshGet('/...', etc.
const regex = /(?:API\.(get|post|put|delete|patch)|cachedGet|freshGet)\s*\(\s*([`'"])(.*?)\2/g;

for (const f of frontendFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = regex.exec(content)) !== null) {
    const method = (match[1] || 'get').toUpperCase();
    const rawUrl = match[3];
    const relFile = path.relative(frontendDir, f);
    calls.push({ file: relFile, method, rawUrl });
  }
}

console.log(`Found ${calls.length} frontend API call sites.`);
const uniqueUrls = [...new Set(calls.map(c => `${c.method} ${c.rawUrl}`))];
console.log(`Unique method + endpoint combinations: ${uniqueUrls.length}`);

// Group by top-level route prefix
const groups = {};
for (const c of uniqueUrls) {
  const [method, url] = c.split(' ');
  const cleanUrl = url.replace(/\$\{.*?\}/g, ':param').split('?')[0];
  const prefix = cleanUrl.split('/')[1] || 'root';
  if (!groups[prefix]) groups[prefix] = [];
  groups[prefix].push({ method, url, cleanUrl });
}

console.log(JSON.stringify(groups, null, 2));
