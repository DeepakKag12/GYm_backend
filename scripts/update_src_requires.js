const fs = require('fs');
const path = require('path');

// 1. Copy publicCache.js to src/middlewares/publicCache.middleware.js
const cacheSource = path.join(__dirname, '../middleware/publicCache.js');
const cacheDest = path.join(__dirname, '../src/middlewares/publicCache.middleware.js');
if (fs.existsSync(cacheSource)) {
  fs.copyFileSync(cacheSource, cacheDest);
}

// 2. Update requires in src/routes/*.routes.js
const routesDir = path.join(__dirname, '../src/routes');
fs.readdirSync(routesDir).forEach((file) => {
  if (file.endsWith('.js')) {
    const fullPath = path.join(routesDir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content.replace(/require\(['"]\.\.\/models\/([A-Za-z0-9_-]+)['"]\)/g, "require('../models/$1.model')");
    content = content.replace(/require\(['"]\.\.\/middleware\/auth['"]\)/g, "require('../middlewares/auth.middleware')");
    content = content.replace(/require\(['"]\.\.\/middleware\/publicCache['"]\)/g, "require('../middlewares/publicCache.middleware')");
    fs.writeFileSync(fullPath, content);
  }
});

// 3. Update requires in src/services/*.js
const servicesDir = path.join(__dirname, '../src/services');
fs.readdirSync(servicesDir).forEach((file) => {
  if (file.endsWith('.js')) {
    const fullPath = path.join(servicesDir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content.replace(/require\(['"]\.\.\/models\/([A-Za-z0-9_-]+)['"]\)/g, "require('../models/$1.model')");
    fs.writeFileSync(fullPath, content);
  }
});

// 4. Update requires in src/utils/*.js
const utilsDir = path.join(__dirname, '../src/utils');
fs.readdirSync(utilsDir).forEach((file) => {
  if (file.endsWith('.js')) {
    const fullPath = path.join(utilsDir, file);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content.replace(/require\(['"]\.\.\/models\/([A-Za-z0-9_-]+)['"]\)/g, "require('../models/$1.model')");
    fs.writeFileSync(fullPath, content);
  }
});

console.log('Successfully updated internal require paths across src/');
