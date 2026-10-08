const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Membership plan validation and parameter extraction logic', () => {
  const reqBody = {
    name: '  Gold Annual Plan  ',
    slug: '  GOLD-ANNUAL  ',
    durationDays: '365',
    price: '9999',
    features: ['All Gym Access', 'Sauna', ''],
    isPopular: 'true',
    isActive: true,
    injectedField: 'hack',
    role: 'admin'
  };

  const parsed = {
    name: String(reqBody.name).trim(),
    slug: String(reqBody.slug).trim().toLowerCase(),
    durationDays: Number(reqBody.durationDays),
    price: Number(reqBody.price),
    features: Array.isArray(reqBody.features) ? reqBody.features.map(f => String(f).trim()).filter(Boolean) : [],
    isPopular: Boolean(reqBody.isPopular),
    isActive: reqBody.isActive !== undefined ? Boolean(reqBody.isActive) : true,
  };

  assert.equal(parsed.name, 'Gold Annual Plan');
  assert.equal(parsed.slug, 'gold-annual');
  assert.equal(parsed.durationDays, 365);
  assert.equal(parsed.price, 9999);
  assert.deepEqual(parsed.features, ['All Gym Access', 'Sauna']);
  assert.equal(parsed.injectedField, undefined);
  assert.equal(parsed.role, undefined);
});
