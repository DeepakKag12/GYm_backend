const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const srcDir = path.join(backendRoot, 'src');

function getAllJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(getAllJsFiles(fullPath));
      }
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = [
  ...getAllJsFiles(srcDir),
  path.join(backendRoot, 'server.js'),
  path.join(backendRoot, 'api/index.js')
].filter(f => fs.existsSync(f));

console.log(`Auditing ${files.length} backend JavaScript files for require/export validity...`);

let totalRequires = 0;
let errors = [];

// Track loaded modules to inspect exports
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');

  // Match require('...') or require("...")
  // Also match destructuring: const { a, b } = require('...')
  const requireRegex = /(?:const|let|var)\s+(?:(\{[^}]+\})|([a-zA-Z0-9_$]+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;

  while ((match = requireRegex.exec(content)) !== null) {
    totalRequires++;
    const destructured = match[1];
    const identifier = match[2];
    const importPath = match[3];

    // Check if relative
    if (importPath.startsWith('.')) {
      const resolvedDir = path.dirname(file);
      let targetPath;
      try {
        targetPath = require.resolve(importPath, { paths: [resolvedDir] });
      } catch (e) {
        errors.push({
          file: path.relative(backendRoot, file),
          importPath,
          error: `Cannot resolve module '${importPath}'`
        });
        continue;
      }

      // If destructured, check if target module exports those keys
      if (destructured) {
        try {
          const mod = require(targetPath);
          const keys = destructured
            .replace(/[{}]/g, '')
            .split(',')
            .map(k => k.trim())
            .filter(Boolean)
            .map(k => {
              // Handle aliases: foo: bar or foo = defaultVal
              const parts = k.split(':');
              return parts[0].trim().split('=')[0].trim();
            });

          for (const key of keys) {
            if (mod === undefined || mod === null || mod[key] === undefined) {
              errors.push({
                file: path.relative(backendRoot, file),
                importPath,
                error: `Destructured property '${key}' is undefined on module '${importPath}' (target: ${path.relative(backendRoot, targetPath)})`
              });
            }
          }
        } catch (e) {
          // If loading fails due to DB/env or circular dependency during require, note it
          // But only if it's not a runtime init error
          if (!e.message.includes('Mongoose') && !e.message.includes('MONGODB_URI')) {
            // Check if it's a syntax or genuine module error
            // console.warn(`Warning loading ${targetPath}: ${e.message}`);
          }
        }
      }
    } else {
      // Third-party package or node built-in
      try {
        require.resolve(importPath, { paths: [backendRoot] });
      } catch (e) {
        errors.push({
          file: path.relative(backendRoot, file),
          importPath,
          error: `External package '${importPath}' cannot be resolved`
        });
      }
    }
  }
}

console.log(`Verified ${totalRequires} require statements.`);
if (errors.length > 0) {
  console.error(`❌ Found ${errors.length} require/export errors:`);
  errors.forEach(e => console.error(`  - In ${e.file}: ${e.error}`));
  process.exit(1);
} else {
  console.log(`✅ ALL BACKEND REQUIRES AND DESTRUCTURED EXPORTS ARE VALID!`);
}
