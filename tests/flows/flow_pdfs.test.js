const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');

const {
  setupTestDb,
  teardownTestDb,
  makeToken,
} = require('../test_helper');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Payment = require('../../src/models/Payment.model');
const Order = require('../../src/models/Order.model');
const Product = require('../../src/models/Product.model');

describe('Flow 5: PDF Streaming, Invoices & Error Resilience E2E Flow', () => {
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

    // Clean up only Flow 5 records
    const users = await User.find({ email: /^flow5_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Payment.deleteMany({ member: { $in: uids } });
      await Order.deleteMany({ user: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }
    await Product.deleteMany({ name: /^Flow5 / });

    adminUser = await User.create({
      name: 'Flow5 Admin',
      email: 'flow5_admin@example.com',
      phone: '9876545001',
      password: 'password123',
      role: 'admin',
    });
    adminToken = makeToken(adminUser);

    member1 = await User.create({
      name: 'Flow5 Member Alpha Very Long Name For Resilience Testing',
      email: 'flow5_mem1@example.com',
      phone: '9876545002',
      password: 'password123',
      role: 'member',
      membershipPlan: 'quarterly',
      membershipStart: new Date('2026-01-01'),
      membershipEnd: new Date('2026-04-01'),
      feeAmount: 3500,
      feeDueAmount: 0,
      feePaid: true,
    });
    token1 = makeToken(member1);

    member2 = await User.create({
      name: 'Flow5 Member Beta',
      email: 'flow5_mem2@example.com',
      phone: '9876545003',
      password: 'password123',
      role: 'member',
      membershipPlan: 'monthly',
      membershipStart: new Date('2026-02-01'),
      membershipEnd: new Date('2026-03-01'),
      feeAmount: 1500,
      feeDueAmount: 1500,
      feePaid: false,
    });
    token2 = makeToken(member2);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  after(async () => {
    if (server?.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    const users = await User.find({ email: /^flow5_/ }).select('_id');
    const uids = users.map((u) => u._id);
    if (uids.length > 0) {
      await Payment.deleteMany({ member: { $in: uids } });
      await Order.deleteMany({ user: { $in: uids } });
      await User.deleteMany({ _id: { $in: uids } });
    }
    await Product.deleteMany({ name: /^Flow5 / });

    await teardownTestDb();
  });

  // 1. Payment Receipt Streaming (Admin-only RBAC per payments.routes.js contract)
  test('1. streamPaymentReceipt: Admin can stream valid PDF receipt; non-admin blocked with 403 by adminOnly guard', async () => {
    const payment = await Payment.create({
      member: member1._id,
      source: 'membership',
      kind: 'new-membership',
      amount: 3500,
      method: 'upi',
      periodStart: member1.membershipStart,
      periodEnd: member1.membershipEnd,
      recordedBy: adminUser._id,
      note: 'Quarterly membership advance',
    });

    // Admin streams receipt
    const resAdmin = await fetch(`${baseUrl}/payments/${payment._id}/receipt`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);
    assert.equal(resAdmin.headers.get('content-type'), 'application/pdf');
    const bufAdmin = Buffer.from(await resAdmin.arrayBuffer());
    assert.equal(bufAdmin.subarray(0, 5).toString('utf8'), '%PDF-');

    // Admin streams receipt with download flag
    const resAdminDl = await fetch(`${baseUrl}/payments/${payment._id}/receipt?download=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdminDl.status, 200);
    assert.match(resAdminDl.headers.get('content-disposition') || '', /attachment;/i);
    const bufAdminDl = Buffer.from(await resAdminDl.arrayBuffer());
    assert.equal(bufAdminDl.subarray(0, 5).toString('utf8'), '%PDF-');

    // Non-admin member is blocked with 403 by adminOnly route guard
    const resMember = await fetch(`${baseUrl}/payments/${payment._id}/receipt`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(resMember.status, 403);

    // Non-existent payment returns 404 for admin
    const fakeId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${baseUrl}/payments/${fakeId}/receipt`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res404.status, 404);
  });

  // 2. Member Statement Streaming (including empty history resilience)
  test('2. streamMemberStatement: Generates valid PDF even for member with 0 payment history; non-admin blocked with 403', async () => {
    // member2 has zero payments in Payment collection
    const countPayments = await Payment.countDocuments({ member: member2._id });
    assert.equal(countPayments, 0);

    // Admin downloads member2's statement (resilience: 0 payments produces valid PDF)
    const res = await fetch(`${baseUrl}/payments/${member2._id}/statement`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString('utf8'), '%PDF-');

    // Non-admin member is blocked with 403 by adminOnly route guard
    const resMember = await fetch(`${baseUrl}/payments/${member2._id}/statement`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    assert.equal(resMember.status, 403);
  });

  // 3. Order Invoice Streaming
  test('3. streamOrderInvoice: Generates valid invoice PDF and enforces access permissions', async () => {
    const product = await Product.create({
      name: 'Flow5 Whey Isolate',
      price: 2999,
      stock: 10,
      category: 'protein',
      isActive: true,
    });

    const order = await Order.create({
      user: member1._id,
      items: [{
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: 1,
      }],
      shippingAddress: {
        address: 'Flow5 Street 1',
        city: 'Indore',
        state: 'MP',
        pincode: '452001',
      },
      paymentMethod: 'cod',
      paymentStatus: 'paid',
      totalAmount: 2999,
    });

    // Owner streams invoice
    const resOwner = await fetch(`${baseUrl}/orders/${order._id}/invoice`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(resOwner.status, 200);
    assert.equal(resOwner.headers.get('content-type'), 'application/pdf');
    const bufOwner = Buffer.from(await resOwner.arrayBuffer());
    assert.equal(bufOwner.subarray(0, 5).toString('utf8'), '%PDF-');

    // Admin streams invoice
    const resAdmin = await fetch(`${baseUrl}/orders/${order._id}/invoice`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdmin.status, 200);

    // Other member gets 403
    const resForbidden = await fetch(`${baseUrl}/orders/${order._id}/invoice`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    assert.equal(resForbidden.status, 403);

    // Non-existent order returns 404
    const fakeId = new mongoose.Types.ObjectId();
    const res404 = await fetch(`${baseUrl}/orders/${fakeId}/invoice`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res404.status, 404);
  });
});
