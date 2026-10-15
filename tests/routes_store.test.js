const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('./test_helper');
const app = require('../src/app');
const User = require('../src/models/User.model');
const Product = require('../src/models/Product.model');

describe('Store Routes & Controller (/api/store)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let memberUser, memberToken;
  let seededProduct;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^storetest_/ });
    await Product.deleteMany({ name: /^StoreTest_/ });

    adminUser = await User.create({
      name: 'Store Admin',
      email: 'storetest_admin@example.com',
      phone: '9876543401',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser = await User.create({
      name: 'Store Member',
      email: 'storetest_member@example.com',
      phone: '9876543402',
      password: 'password123',
      role: 'member',
    });
    memberToken = makeToken(memberUser);

    seededProduct = await Product.create({
      name: 'StoreTest_WheyGold',
      description: 'Gold Standard 100% Whey',
      price: 3000,
      discountPrice: 2700,
      stock: 15,
      category: 'protein',
      isFeatured: true,
      isActive: true,
      flavors: ['Chocolate', 'Vanilla'],
      weights: ['1kg', '2kg'],
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/store`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^storetest_/ });
    await Product.deleteMany({ name: /^StoreTest_/ });
    await teardownTestDb();
  });

  // 1. GET /api/store (Public listing & filters)
  test('1. Public can GET /api/store without token and filter by category/search', async () => {
    const res = await fetch(`${baseUrl}?category=protein&search=Gold`);
    assert.equal(res.status, 200);
    const products = await res.json();
    assert.ok(Array.isArray(products));
    const found = products.find((p) => p._id.toString() === seededProduct._id.toString());
    assert.ok(found);
    assert.equal(found.name, 'StoreTest_WheyGold');
  });

  // 2. GET /api/store/:id
  test('2. Public can GET /api/store/:id and get 404 for nonexistent id', async () => {
    const resSuccess = await fetch(`${baseUrl}/${seededProduct._id}`);
    assert.equal(resSuccess.status, 200);
    const product = await resSuccess.json();
    assert.equal(product._id, seededProduct._id.toString());

    const fakeId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${baseUrl}/${fakeId}`);
    assert.equal(res404.status, 404);
  });

  // 3. POST /api/store (create product)
  test('3. Non-admin is blocked with 403 on POST /api/store', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ name: 'StoreTest_Banned', price: 100 }),
    });
    assert.equal(res.status, 403);
  });

  test('4. Admin can create product with price and discountPrice validation', async () => {
    // Rejects discountPrice > price
    const resInvalid = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'StoreTest_InvalidDiscount',
        category: 'creatine',
        price: 1000,
        discountPrice: 1500, // Invalid!
        stock: 10,
      }),
    });
    assert.equal(resInvalid.status, 400);

    // Creates valid product
    const resValid = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: 'StoreTest_CreatinePure',
        category: 'creatine',
        price: 1200,
        discountPrice: 999,
        stock: 20,
      }),
    });
    assert.equal(resValid.status, 201);
    const created = await resValid.json();
    assert.equal(created.name, 'StoreTest_CreatinePure');
    assert.equal(created.discountPrice, 999);
  });

  // 4. PUT /api/store/:id
  test('5. updateProduct rejects discountPrice exceeding original price when price is omitted', async () => {
    // seededProduct has price: 3000. Trying to set discountPrice: 3500 without sending price in body.
    const res = await fetch(`${baseUrl}/${seededProduct._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        discountPrice: 3500, // Exceeds original price 3000!
      }),
    });
    assert.equal(res.status, 400, 'Expected 400 when discountPrice exceeds original product price');
    const data = await res.json();
    assert.match(data.message, /cannot exceed/i);
  });

  test('6. Admin can update valid product fields', async () => {
    const res = await fetch(`${baseUrl}/${seededProduct._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        price: 3200,
        discountPrice: 2800,
        stock: 25,
      }),
    });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.price, 3200);
    assert.equal(updated.discountPrice, 2800);
    assert.equal(updated.stock, 25);
  });

  // 5. POST /api/store/:id/review
  test('7. Member can add and update product review, rating is recalculated', async () => {
    // Add review
    const res1 = await fetch(`${baseUrl}/${seededProduct._id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ rating: 5, comment: 'Great taste and mixability!' }),
    });
    assert.equal(res1.status, 200);
    const prod1 = await res1.json();
    assert.equal(prod1.reviewCount, 1);
    assert.equal(prod1.rating, 5);

    // Update review
    const res2 = await fetch(`${baseUrl}/${seededProduct._id}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ rating: 4, comment: 'Good, but a bit sweet.' }),
    });
    assert.equal(res2.status, 200);
    const prod2 = await res2.json();
    assert.equal(prod2.reviewCount, 1); // Still 1 review, not duplicated
    assert.equal(prod2.rating, 4);
  });

  // 6. DELETE /api/store/:id
  test('8. Admin can delete product, non-admin blocked with 403', async () => {
    const tempProd = await Product.create({
      name: 'StoreTest_TempDelete',
      price: 500,
      category: 'accessories',
    });

    const resNonAdmin = await fetch(`${baseUrl}/${tempProd._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    assert.equal(resNonAdmin.status, 403);

    const resAdmin = await fetch(`${baseUrl}/${tempProd._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);

    const check = await Product.findById(tempProd._id);
    assert.equal(check, null);
  });
});
