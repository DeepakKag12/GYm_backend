const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('../test_helper');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Product = require('../../src/models/Product.model');
const Order = require('../../src/models/Order.model');

describe('Flow 4: Store & Order Transactions E2E Flow', () => {
  let server;
  let baseUrl;
  let adminUser;
  let adminToken;
  let member1;
  let token1;
  let member2;
  let token2;

  before(async () => {
    await setupTestDb();

    // Scoped cleanup for Flow 4
    const existingUsers = await User.find({ email: /^flow4_/ }).select('_id');
    const uids = existingUsers.map((u) => u._id);
    if (uids.length > 0) {
      await Order.deleteMany({ user: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }
    await Product.deleteMany({ name: /^Flow4 / });

    adminUser = await User.create({
      name: 'Flow4 Admin',
      email: 'flow4_admin@example.com',
      phone: '9876544001',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    member1 = await User.create({
      name: 'Flow4 Member One',
      email: 'flow4_mem1@example.com',
      phone: '9876544002',
      password: 'password123',
      role: 'member',
    });
    token1 = makeToken(member1);

    member2 = await User.create({
      name: 'Flow4 Member Two',
      email: 'flow4_mem2@example.com',
      phone: '9876544003',
      password: 'password123',
      role: 'member',
    });
    token2 = makeToken(member2);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/orders`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    const users = await User.find({ email: /^flow4_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Order.deleteMany({ user: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }
    await Product.deleteMany({ name: /^Flow4 / });

    await teardownTestDb();
  });

  // 1. Concurrent checkout on the last unit of stock
  test('1. Concurrent checkouts on last stock unit results in exactly one winner and one 409 conflict', async () => {
    const scarceProduct = await Product.create({
      name: 'Flow4 Scarce Whey Protein',
      price: 2500,
      stock: 1,
      category: 'protein',
      isActive: true,
    });

    // Launch 2 concurrent checkout requests for the same single unit
    const req1 = fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        items: [{ product: scarceProduct._id.toString(), quantity: 1 }],
        paymentMethod: 'cod',
      }),
    });

    const req2 = fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token2}`,
      },
      body: JSON.stringify({
        items: [{ product: scarceProduct._id.toString(), quantity: 1 }],
        paymentMethod: 'cod',
      }),
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();

    // Exactly one must succeed (201) and one must be rejected with 409 Conflict
    assert.deepEqual(statuses, [201, 409], 'One request must succeed with 201, the other must fail with 409');

    // Verify stock is now 0 (not negative)
    const productAfter = await Product.findById(scarceProduct._id);
    assert.equal(productAfter.stock, 0);
  });

  // 2. Multi-item checkout rollback
  test('2. Multi-item checkout rolls back atomically if any item has insufficient stock', async () => {
    const inStockProduct = await Product.create({
      name: 'Flow4 In Stock BCAA',
      price: 1200,
      stock: 10,
      category: 'protein',
      isActive: true,
    });

    const outOfStockProduct = await Product.create({
      name: 'Flow4 Zero Stock Shaker',
      price: 300,
      stock: 0,
      category: 'accessories',
      isActive: true,
    });

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        items: [
          { product: inStockProduct._id.toString(), quantity: 2 },
          { product: outOfStockProduct._id.toString(), quantity: 1 },
        ],
        paymentMethod: 'cod',
      }),
    });

    assert.equal(res.status, 409);
    const errBody = await res.json();
    assert.match(errBody.message, /does not have.*left in stock/i);

    // Verify in-stock product was NOT partially decremented
    const productAfter = await Product.findById(inStockProduct._id);
    assert.equal(productAfter.stock, 10, 'Product A stock must remain 10 after atomic transaction rollback');
  });

  // 3. Idempotent order placement
  test('3. Placing an order with idempotencyKey prevents duplicate orders and double stock decrements', async () => {
    const product = await Product.create({
      name: 'Flow4 Creatine Monohydrate',
      price: 999,
      discountPrice: 799,
      stock: 5,
      category: 'protein',
      isActive: true,
    });

    const idempotencyKey = 'flow4_idem_order_xyz';

    // First attempt
    const res1 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        items: [{ product: product._id.toString(), quantity: 2 }],
        paymentMethod: 'cod',
        idempotencyKey,
      }),
    });
    assert.equal(res1.status, 201);
    const order1 = await res1.json();
    assert.equal(order1.totalAmount, 799 * 2);

    const stockAfter1 = await Product.findById(product._id);
    assert.equal(stockAfter1.stock, 3); // 5 - 2 = 3

    // Retry with SAME idempotencyKey
    const res2 = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        items: [{ product: product._id.toString(), quantity: 2 }],
        paymentMethod: 'cod',
        idempotencyKey,
      }),
    });
    assert.equal(res2.status, 200);
    const order2 = await res2.json();
    assert.equal(order2._id, order1._id);

    // Stock must STILL be 3, not decremented again
    const stockAfter2 = await Product.findById(product._id);
    assert.equal(stockAfter2.stock, 3, 'Stock must not be decremented on idempotent retry');
  });

  // 4. Order cancellation stock restoration (single restoration guarantee)
  test('4. Order cancellation restores product stock exactly once; duplicate cancellation does not double-restore', async () => {
    const product = await Product.create({
      name: 'Flow4 Pre-Workout Booster',
      price: 1800,
      stock: 4,
      category: 'protein',
      isActive: true,
    });

    // Place order for 2 units
    const orderRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        items: [{ product: product._id.toString(), quantity: 2 }],
        paymentMethod: 'cod',
      }),
    });
    assert.equal(orderRes.status, 201);
    const order = await orderRes.json();

    const stockOrdered = await Product.findById(product._id);
    assert.equal(stockOrdered.stock, 2);

    // Admin cancels the order -> stock restored to 4
    const cancelRes1 = await fetch(`${baseUrl}/${order._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderStatus: 'cancelled' }),
    });
    assert.equal(cancelRes1.status, 200);
    const cancelledOrder = await cancelRes1.json();
    assert.equal(cancelledOrder.orderStatus, 'cancelled');
    assert.equal(cancelledOrder.stockRestored, true);

    const stockRestored1 = await Product.findById(product._id);
    assert.equal(stockRestored1.stock, 4, 'Stock must be restored to 4 after cancellation');

    // Second cancellation call must NOT restore stock again
    const cancelRes2 = await fetch(`${baseUrl}/${order._id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ orderStatus: 'cancelled' }),
    });
    assert.equal(cancelRes2.status, 200);

    const stockRestored2 = await Product.findById(product._id);
    assert.equal(stockRestored2.stock, 4, 'Stock must stay 4 and NOT double-increment');
  });

  // 5. Invoicing and IDOR security
  test('5. Member can stream their own invoice, Admin can stream any invoice, Member 2 gets 403 Forbidden', async () => {
    const product = await Product.create({
      name: 'Flow4 Lifting Straps',
      price: 499,
      stock: 10,
      category: 'accessories',
      isActive: true,
    });

    const orderRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`,
      },
      body: JSON.stringify({
        items: [{ product: product._id.toString(), quantity: 1 }],
        paymentMethod: 'cod',
      }),
    });
    const order = await orderRes.json();

    // Member 1 (owner) streams invoice -> 200 with PDF
    const resOwner = await fetch(`${baseUrl}/${order._id}/invoice`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(resOwner.status, 200);
    const pdfOwner = await resOwner.arrayBuffer();
    const headerOwner = Buffer.from(pdfOwner).subarray(0, 5).toString('utf8');
    assert.equal(headerOwner, '%PDF-');

    // Admin streams invoice -> 200 with PDF
    const resAdmin = await fetch(`${baseUrl}/${order._id}/invoice`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);

    // Member 2 (not owner) tries to stream invoice -> 403 Forbidden
    const resOther = await fetch(`${baseUrl}/${order._id}/invoice`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    assert.equal(resOther.status, 403, 'Member 2 must be blocked with 403 from accessing Member 1 invoice');
  });
});
