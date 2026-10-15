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
const Order = require('../src/models/Order.model');

describe('Orders Routes & Controller (/api/orders)', () => {
  let server;
  let baseUrl;
  let adminUser, adminToken;
  let memberUser1, memberToken1;
  let memberUser2, memberToken2;
  let testProduct1, testProduct2;

  before(async () => {
    await setupTestDb();

    await User.deleteMany({ email: /^ordertest_/ });
    await Product.deleteMany({ name: /^OrderTest_/ });
    await Order.deleteMany({});

    adminUser = await User.create({
      name: 'Order Admin',
      email: 'ordertest_admin@example.com',
      phone: '9876543301',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    memberUser1 = await User.create({
      name: 'Order Member One',
      email: 'ordertest_member1@example.com',
      phone: '9876543302',
      password: 'password123',
      role: 'member',
    });
    memberToken1 = makeToken(memberUser1);

    memberUser2 = await User.create({
      name: 'Order Member Two',
      email: 'ordertest_member2@example.com',
      phone: '9876543303',
      password: 'password123',
      role: 'member',
    });
    memberToken2 = makeToken(memberUser2);

    testProduct1 = await Product.create({
      name: 'OrderTest_Protein',
      description: 'High quality whey',
      price: 2500,
      discountPrice: 2200,
      stock: 5,
      category: 'protein',
      isActive: true,
    });

    testProduct2 = await Product.create({
      name: 'OrderTest_Creatine',
      description: 'Micronized creatine',
      price: 1000,
      discountPrice: 900,
      stock: 1, // Only 1 in stock for race/stockout test
      category: 'creatine',
      isActive: true,
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/orders`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await User.deleteMany({ email: /^ordertest_/ });
    await Product.deleteMany({ name: /^OrderTest_/ });
    await Order.deleteMany({});
    await teardownTestDb();
  });

  // 1. RBAC & Validation for placing orders
  test('1. Unauthenticated request to place order is rejected with 401', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 401);
  });

  test('2. placeOrder rejects empty items array with 400', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 400);
  });

  test('3. placeOrder rejects invalid quantity with 400', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({
        items: [{ product: testProduct1._id.toString(), quantity: -2 }],
      }),
    });
    assert.equal(res.status, 400);
  });

  test('4. placeOrder rejects unavailable product with 400', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({
        items: [{ product: fakeId.toString(), quantity: 1 }],
      }),
    });
    assert.equal(res.status, 400);
  });

  test('5. placeOrder rejects when order quantity exceeds stock with 409', async () => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({
        items: [{ product: testProduct2._id.toString(), quantity: 10 }], // only 1 in stock
      }),
    });
    assert.equal(res.status, 409);
  });

  // 2. Successful order and stock decrement
  let placedOrder;
  test('6. placeOrder succeeds, decrements stock, uses server discountPrice', async () => {
    const initialProduct1 = await Product.findById(testProduct1._id);
    const initialStock = initialProduct1.stock;

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({
        items: [{ product: testProduct1._id.toString(), quantity: 2 }],
        shippingAddress: {
          address: '123 Test St',
          city: 'Indore',
          state: 'MP',
          pincode: '452001',
        },
        paymentMethod: 'cod',
      }),
    });
    assert.equal(res.status, 201);
    placedOrder = await res.json();
    assert.ok(placedOrder._id);
    assert.equal(placedOrder.totalAmount, 2200 * 2); // 4400, not client price

    const updatedProduct = await Product.findById(testProduct1._id);
    assert.equal(updatedProduct.stock, initialStock - 2);
  });

  // 3. Idempotency test
  test('7. placeOrder with same idempotencyKey returns existing order without extra stock decrement', async () => {
    const initialProduct = await Product.findById(testProduct1._id);
    const stockBefore = initialProduct.stock;
    const idempotencyKey = `ord_idem_${Date.now()}`;

    const payload = {
      items: [{ product: testProduct1._id.toString(), quantity: 1 }],
      idempotencyKey,
    };

    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res1.status, 201);
    const order1 = await res1.json();

    const stockAfterFirst = (await Product.findById(testProduct1._id)).stock;
    assert.equal(stockAfterFirst, stockBefore - 1);

    // Second call with same idempotencyKey
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res2.status, 200);
    const order2 = await res2.json();
    assert.equal(order2._id, order1._id);

    const stockAfterSecond = (await Product.findById(testProduct1._id)).stock;
    assert.equal(stockAfterSecond, stockAfterFirst); // Stock was not decremented again
  });

  // 4. GET /api/orders/my
  test('8. Member can fetch their own orders, cannot see other members orders', async () => {
    const res1 = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(res1.status, 200);
    const orders1 = await res1.json();
    assert.ok(Array.isArray(orders1));
    assert.ok(orders1.length >= 2);
    assert.ok(orders1.every((o) => o.user.toString() === memberUser1._id.toString()));

    const res2 = await fetch(`${baseUrl}/my`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(res2.status, 200);
    const orders2 = await res2.json();
    assert.ok(Array.isArray(orders2));
    assert.equal(orders2.length, 0); // Member 2 has no orders
  });

  // 5. GET /api/orders (admin all orders)
  test('9. Admin can fetch all orders with pagination headers, non-admin blocked with 403', async () => {
    const nonAdminRes = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(nonAdminRes.status, 403);

    const adminRes = await fetch(`${baseUrl}?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRes.status, 200);
    assert.ok(adminRes.headers.get('x-total-count'));
    const orders = await adminRes.json();
    assert.ok(Array.isArray(orders));
    assert.ok(orders.length >= 2);
  });

  // 6. PUT /api/orders/:id/status
  test('10. Admin can update order status; non-admin blocked with 403', async () => {
    const nonAdminRes = await fetch(`${baseUrl}/${placedOrder._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken1}`,
      },
      body: JSON.stringify({ orderStatus: 'confirmed' }),
    });
    assert.equal(nonAdminRes.status, 403);

    const adminRes = await fetch(`${baseUrl}/${placedOrder._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderStatus: 'confirmed' }),
    });
    assert.equal(adminRes.status, 200);
    const updated = await adminRes.json();
    assert.equal(updated.orderStatus, 'confirmed');
  });

  test('11. Cancelling an order restores product stock exactly once', async () => {
    const stockBeforeCancel = (await Product.findById(testProduct1._id)).stock;

    // First cancel - should restore 2 units
    const res1 = await fetch(`${baseUrl}/${placedOrder._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderStatus: 'cancelled' }),
    });
    assert.equal(res1.status, 200);
    const stockAfterFirstCancel = (await Product.findById(testProduct1._id)).stock;
    assert.equal(stockAfterFirstCancel, stockBeforeCancel + 2);

    // Second status update while cancelled - must NOT restore stock again
    const res2 = await fetch(`${baseUrl}/${placedOrder._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderStatus: 'cancelled', paymentStatus: 'refunded' }),
    });
    assert.equal(res2.status, 200);
    const stockAfterSecondCancel = (await Product.findById(testProduct1._id)).stock;
    assert.equal(stockAfterSecondCancel, stockAfterFirstCancel);
  });

  // 7. GET /api/orders/:id/invoice (PDF Streaming & IDOR check)
  test('12. Member can stream their own invoice, Admin can stream any invoice, Member 2 gets 403 (IDOR check)', async () => {
    // Member 1 can stream their own invoice
    const resOwn = await fetch(`${baseUrl}/${placedOrder._id}/invoice`, {
      headers: { Authorization: `Bearer ${memberToken1}` },
    });
    assert.equal(resOwn.status, 200);
    assert.equal(resOwn.headers.get('content-type'), 'application/pdf');
    const bufOwn = await resOwn.arrayBuffer();
    assert.equal(Buffer.from(bufOwn.slice(0, 5)).toString('utf8'), '%PDF-');

    // Admin can stream Member 1's invoice
    const resAdmin = await fetch(`${baseUrl}/${placedOrder._id}/invoice`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.headers.get('content-type'), 'application/pdf');

    // Member 2 CANNOT stream Member 1's invoice (IDOR defense)
    const resOther = await fetch(`${baseUrl}/${placedOrder._id}/invoice`, {
      headers: { Authorization: `Bearer ${memberToken2}` },
    });
    assert.equal(resOther.status, 403);
    const err = await resOther.json();
    assert.match(err.message, /access denied/i);
  });
});
