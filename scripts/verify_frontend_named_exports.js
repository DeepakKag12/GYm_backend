const fs = require('fs');
const path = require('path');

const frontendSrc = path.resolve(__dirname, '../../frontend/frontend/src');
const frontendRoot = path.resolve(__dirname, '../../frontend/frontend');

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
    } else if (/\.(js|jsx|ts|tsx)$/.test(file)) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = getAllFiles(frontendSrc);
console.log(`Auditing named and default imports across ${files.length} frontend files...`);

let totalImports = 0;
let errors = [];

// Helper to resolve relative path
function resolveModule(sourceFile, importPath) {
  const dir = path.dirname(sourceFile);
  const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx'];
  for (const ext of extensions) {
    const target = path.resolve(dir, importPath + ext);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return target;
    }
  }
  return null;
}

// Helper to extract exported identifiers from a frontend JS/JSX file (recursive for export * from ...)
function extractExports(filePath, visited = new Set()) {
  if (visited.has(filePath)) return { exports: new Set(), hasDefaultExport: false };
  visited.add(filePath);

  const content = fs.readFileSync(filePath, 'utf8');
  const exports = new Set();
  let hasDefaultExport = false;

  // export default ...
  if (/export\s+default\s+/m.test(content)) {
    hasDefaultExport = true;
  }

  // export (async) const/let/var/function/class Name
  const namedDeclRegex = /export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([a-zA-Z0-9_$]+)/g;
  let m;
  while ((m = namedDeclRegex.exec(content)) !== null) {
    exports.add(m[1]);
  }

  // export { a, b, c as d }
  const namedClauseRegex = /export\s*\{([^}]+)\}/g;
  while ((m = namedClauseRegex.exec(content)) !== null) {
    const clause = m[1];
    clause.split(',').forEach(item => {
      const parts = item.trim().split(/\s+as\s+/);
      const exportedName = (parts[1] || parts[0]).trim();
      if (exportedName) {
        if (exportedName === 'default') {
          hasDefaultExport = true;
        } else {
          exports.add(exportedName);
        }
      }
    });
  }

  // export * from './something'
  const exportAllRegex = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = exportAllRegex.exec(content)) !== null) {
    const reExportPath = m[1];
    const resolvedReExport = resolveModule(filePath, reExportPath);
    if (resolvedReExport) {
      const subExports = extractExports(resolvedReExport, visited);
      subExports.exports.forEach(e => exports.add(e));
    }
  }

  return { exports, hasDefaultExport, content };
}

// Package.json check
const pkgJson = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
const allDeps = {
  ...pkgJson.dependencies,
  ...pkgJson.devDependencies,
  react: true,
  'react-dom': true
};

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');
}

for (const file of files) {
  const rawContent = fs.readFileSync(file, 'utf8');
  const content = stripComments(rawContent);

  // Match: import ... from '...'
  const importRegex = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    totalImports++;
    const importClause = match[1] ? match[1].trim() : null;
    const importSource = match[2].trim();

    // Check external packages vs package.json
    if (!importSource.startsWith('.') && !importSource.startsWith('/')) {
      // CSS or package import
      if (importSource.endsWith('.css')) continue;
      const pkgName = importSource.startsWith('@')
        ? importSource.split('/').slice(0, 2).join('/')
        : importSource.split('/')[0];

      if (!allDeps[pkgName]) {
        errors.push({
          file: path.relative(frontendRoot, file),
          source: importSource,
          error: `Importing package '${pkgName}' which is not in package.json dependencies`
        });
      }
      continue;
    }

    // Relative module
    if (importSource.endsWith('.css') || importSource.endsWith('.svg') || importSource.endsWith('.png') || importSource.endsWith('.jpg')) {
      continue;
    }

    const resolved = resolveModule(file, importSource);
    if (!resolved) {
      errors.push({
        file: path.relative(frontendRoot, file),
        source: importSource,
        error: `Could not resolve '${importSource}'`
      });
      continue;
    }

    if (!importClause) continue;

    // Check named imports: { a, b, c as d }
    const namedMatch = importClause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const { exports } = extractExports(resolved);
      const names = namedMatch[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const name of names) {
        if (!exports.has(name)) {
          errors.push({
            file: path.relative(frontendRoot, file),
            source: importSource,
            error: `'${name}' is imported from '${importSource}' (${path.relative(frontendRoot, resolved)}) but not exported! Known exports: [${Array.from(exports).join(', ')}]`
          });
        }
      }
    }

    // Check default import: import Foo from '...' or import Foo, { ... }
    const defaultMatch = importClause.replace(/\{[^}]+\}/, '').replace(/,/g, '').trim();
    if (defaultMatch && !defaultMatch.startsWith('* as')) {
      const { hasDefaultExport } = extractExports(resolved);
      if (!hasDefaultExport) {
        errors.push({
          file: path.relative(frontendRoot, file),
          source: importSource,
          error: `Default import '${defaultMatch}' from '${importSource}' (${path.relative(frontendRoot, resolved)}) has no default export!`
        });
      }
    }
  }
}

console.log(`Verified ${totalImports} frontend import declarations.`);
if (errors.length > 0) {
  console.error(`❌ Found ${errors.length} import/export errors:`);
  errors.forEach(e => console.error(`  - In ${e.file}: ${e.error}`));
  process.exit(1);
} else {
  console.log(`✅ ALL FRONTEND IMPORTS AND EXPORTS ARE 100% VALID!`);
}
