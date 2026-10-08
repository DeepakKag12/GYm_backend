const fs = require('fs');
const path = require('path');

const frontendDir = path.resolve(__dirname, '../../frontend/frontend/src');

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

const allFiles = walk(frontendDir);
let totalImportsChecked = 0;
let errors = 0;

// Match import statements:
// import defaultExport from './path'
// import { a, b } from './path'
// import * as name from './path'
// import './path'
const importRegex = /import\s+(?:(?:\*\s+as\s+\w+|[\w\s{},]+)\s+from\s+)?['"]([^'"]+)['"]/g;

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];

    // Only check local relative imports
    if (importPath.startsWith('.')) {
      totalImportsChecked++;
      const dir = path.dirname(f);
      let resolved = path.resolve(dir, importPath);

      // Check extensions: .js, .jsx, /index.js, /index.jsx
      const candidates = [
        resolved,
        resolved + '.js',
        resolved + '.jsx',
        path.join(resolved, 'index.js'),
        path.join(resolved, 'index.jsx'),
        resolved + '.css',
        resolved + '.json',
        resolved + '.png',
        resolved + '.jpg',
        resolved + '.jpeg',
        resolved + '.svg',
        resolved + '.webp',
      ];

      const exists = candidates.some(c => fs.existsSync(c) && fs.statSync(c).isFile());
      if (!exists) {
        console.error(`❌ BROKEN IMPORT in ${path.relative(frontendDir, f)}: cannot resolve "${importPath}"`);
        errors++;
      }
    }
  }
}

console.log(`\nVerified ${totalImportsChecked} local relative imports across ${allFiles.length} files.`);
if (errors === 0) {
  console.log('✅ ALL FRONTEND LOCAL IMPORTS RESOLVE TO EXISTING FILES!');
} else {
  console.error(`❌ Found ${errors} broken imports.`);
  process.exit(1);
}
