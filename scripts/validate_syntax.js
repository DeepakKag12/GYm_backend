const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walk(dir) {
  let files = [];
  for (const item of fs.readdirSync(dir)) {
    if (item === 'node_modules') continue;
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      files = files.concat(walk(full));
    } else if (full.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const backendDir = path.resolve(__dirname, '..');
const allFiles = walk(backendDir);
console.log('Total backend files to check:', allFiles.length);

let errors = 0;
for (const file of allFiles) {
  try {
    execSync(`node --check "${file}"`);
  } catch (err) {
    console.error('Syntax error in:', file);
    errors++;
  }
}

if (errors === 0) {
  console.log('✅ ALL', allFiles.length, 'backend files passed node --check syntax verification with ZERO errors!');
} else {
  console.log('❌ Found', errors, 'syntax errors.');
  process.exit(1);
}
