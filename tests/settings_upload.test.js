const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

test('BUG-01: file extension validation for image upload', () => {
  const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
  
  function isAllowedExtension(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_EXTS.includes(ext);
  }

  assert.strictEqual(isAllowedExtension('test.jpg'), true);
  assert.strictEqual(isAllowedExtension('test.PNG'), true);
  assert.strictEqual(isAllowedExtension('test.webp'), true);
  assert.strictEqual(isAllowedExtension('malicious.exe'), false);
  assert.strictEqual(isAllowedExtension('script.sh'), false);
  assert.strictEqual(isAllowedExtension('attack.html'), false);
});
