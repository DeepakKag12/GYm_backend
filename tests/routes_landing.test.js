const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('./test_helper');
const app = require('../src/app');
const User = require('../src/models/User.model');
const LandingConfig = require('../src/models/LandingConfig.model');

describe('Landing Routes & Controller (/api/landing)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let memberUser, memberToken;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^landingtest_/ });
    await LandingConfig.deleteMany({});

    adminUser = await User.create({
      name: 'Landing Admin',
      email: 'landingtest_admin@example.com',
      phone: '9876543701',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'Landing Member',
      email: 'landingtest_member@example.com',
      phone: '9876543702',
      password: 'password123',
      role: 'member',
    });
    memberToken = makeToken(memberUser);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/landing`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^landingtest_/ });
    await LandingConfig.deleteMany({});
    await teardownTestDb();
  });

  test('1. Public can GET /api/landing with complete default configuration', async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 200);
    const config = await res.json();
    assert.ok(config);
    assert.equal(config.key, 'landing');
    assert.equal(config.theme.primaryColor, '#3366E4');
    assert.equal(config.theme.secondaryColor, '#15324D');
    assert.equal(config.about.stats.length, 4);
    assert.equal(config.about.stats[0].value, '4000+');
    assert.equal(config.programs.length, 8);
    assert.equal(config.policies.coreCards.length, 4);
    assert.equal(config.policies.additionalRules.length, 6);
    assert.equal(config.policies.etiquette.length, 5);
    assert.equal(config.cafe.features.length, 5);
    assert.equal(config.membership.plans.length, 2);
    assert.equal(config.membership.plans[0].price, 1500);
    assert.equal(config.membership.plans[1].price, 3600);
  });

  test('2. Unauthenticated PUT /api/landing is rejected with 401', async () => {
    const res = await fetch(baseUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hero: { headline: 'New Headline' } }),
    });
    assert.equal(res.status, 401);
  });

  test('3. Non-admin PUT /api/landing is rejected with 403', async () => {
    const res = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ hero: { headline: 'New Headline' } }),
    });
    assert.equal(res.status, 403);
  });

  test('4. Admin PUT /api/landing successfully updates fields and invalidates cache', async () => {
    const updatePayload = {
      hero: {
        headline: 'Transform Your Body at FitNation',
        subtext: 'Exclusive Training Hub in Rajgarh',
      },
      sectionVisibility: {
        cafe: false,
      },
    };

    const res = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(updatePayload),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.config.hero.headline, 'Transform Your Body at FitNation');
    assert.equal(data.config.sectionVisibility.cafe, false);

    // Verify GET reflects the update
    const getRes = await fetch(baseUrl);
    const refreshed = await getRes.json();
    assert.equal(refreshed.hero.headline, 'Transform Your Body at FitNation');
    assert.equal(refreshed.sectionVisibility.cafe, false);
  });
});
