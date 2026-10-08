require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const { connectDB } = require('../src/config/db');
const app = require('../src/app');

async function runCompleteCycle() {
  console.log('====================================================');
  console.log('🚀 RUNNING COMPLETE APPLICATION LIFECYCLE AUDIT TEST');
  console.log('====================================================');

  await connectDB();
  console.log('Connected to MongoDB Atlas.\n');

  // Start app on ephemeral port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  console.log(`Backend server listening at ${baseUrl} for integration tests\n`);

  async function req(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const contentType = res.headers.get('content-type') || '';
    let body;
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return { status: res.status, headers: res.headers, body };
  }

  let testResults = [];
  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAILED: ${message}`);
      testResults.push({ passed: false, message });
      throw new Error(message);
    } else {
      console.log(`✅ PASSED: ${message}`);
      testResults.push({ passed: true, message });
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // CYCLE 1: Public Marketing Flow
    // ─────────────────────────────────────────────────────────────
    console.log('--- [CYCLE 1] Public Marketing Flow ---');
    
    // 1.1 Health
    const resHealth = await req('/health');
    assert(resHealth.status === 200 && resHealth.body.status === 'ok', 'GET /api/health returns 200 and ok status');

    // 1.2 Settings
    const resSettings = await req('/settings');
    assert(resSettings.status === 200 && resSettings.body.gymName, 'GET /api/settings returns 200 with gymName');

    // 1.3 Plans
    const resPlans = await req('/plans');
    const plansData = resPlans.body.plans || resPlans.body;
    assert(resPlans.status === 200 && Array.isArray(plansData) && plansData.length > 0, `GET /api/plans returns ${plansData.length} plans`);

    // 1.4 Store Products
    const resStore = await req('/store');
    const storeItems = Array.isArray(resStore.body.products) ? resStore.body.products : (Array.isArray(resStore.body) ? resStore.body : []);
    assert(resStore.status === 200 && storeItems.length > 0, `GET /api/store returns 200 with ${storeItems.length} products`);

    const sampleProductId = storeItems[0]._id;
    const resProductDetail = await req(`/store/${sampleProductId}`);
    assert(resProductDetail.status === 200 && (resProductDetail.body.product?._id || resProductDetail.body._id), `GET /api/store/${sampleProductId} returns product detail`);

    // 1.5 Exercises
    const resExercises = await req('/exercises');
    const exerciseList = Array.isArray(resExercises.body.exercises) ? resExercises.body.exercises : (Array.isArray(resExercises.body) ? resExercises.body : []);
    assert(resExercises.status === 200 && exerciseList.length > 0, `GET /api/exercises returns 200 with ${exerciseList.length} exercises`);

    const sampleExerciseId = exerciseList[0]._id;
    const resExerciseDetail = await req(`/exercises/${sampleExerciseId}`);
    assert(resExerciseDetail.status === 200 && (resExerciseDetail.body.exercise?._id || resExerciseDetail.body._id), `GET /api/exercises/${sampleExerciseId} returns exercise detail`);

    // 1.6 Diet plans
    const resDiet = await req('/diet');
    const dietList = Array.isArray(resDiet.body.dietPlans) ? resDiet.body.dietPlans : (Array.isArray(resDiet.body) ? resDiet.body : []);
    assert(resDiet.status === 200 && dietList.length > 0, `GET /api/diet returns 200 with ${dietList.length} diet plans`);

    // 1.7 Transformations
    const resTransformations = await req('/transformations');
    const transformationList = Array.isArray(resTransformations.body.transformations) ? resTransformations.body.transformations : (Array.isArray(resTransformations.body) ? resTransformations.body : []);
    assert(resTransformations.status === 200 && transformationList.length > 0, `GET /api/transformations returns 200 with ${transformationList.length} items`);

    // 1.8 Submit Enquiry
    const enquiryPayload = {
      name: 'Cycle Test Lead',
      email: 'cycletest@example.com',
      phone: '9999988888',
      message: 'Testing complete application cycle',
      planInterest: 'Pro'
    };
    const resEnquiry = await req('/enquiries', { method: 'POST', body: enquiryPayload });
    assert(resEnquiry.status === 201 || resEnquiry.status === 200, 'POST /api/enquiries creates new lead');
    const createdEnquiryId = resEnquiry.body.enquiry?._id || resEnquiry.body._id;

    // ─────────────────────────────────────────────────────────────
    // CYCLE 2: Authentication Cycle (Admin & Member)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- [CYCLE 2] Authentication & Token Lifecycle ---');

    // 2.1 Admin login
    const adminLoginRes = await req('/auth/login', {
      method: 'POST',
      body: { email: 'admin@fitnation.com', password: 'admin123' }
    });
    assert(adminLoginRes.status === 200 && adminLoginRes.body.token, 'POST /api/auth/login succeeds for admin');
    const adminToken = adminLoginRes.body.token;
    assert(adminLoginRes.body.user.role === 'admin', 'Admin login returns admin role');

    // 2.2 Verify Admin Auth Me
    const adminMeRes = await req('/auth/me', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(adminMeRes.status === 200 && (adminMeRes.body.email === 'admin@fitnation.com' || adminMeRes.body.user?.email === 'admin@fitnation.com'), 'GET /api/auth/me returns admin profile');

    // 2.3 Member login
    const memberLoginRes = await req('/auth/login', {
      method: 'POST',
      body: { email: 'aman@gmail.com', password: 'member123' }
    });
    assert(memberLoginRes.status === 200 && memberLoginRes.body.token, 'POST /api/auth/login succeeds for member');
    const memberToken = memberLoginRes.body.token;
    const memberId = memberLoginRes.body.user._id || memberLoginRes.body.user.id;

    // 2.4 Verify Member Auth Me
    const memberMeRes = await req('/auth/me', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberMeRes.status === 200 && (memberMeRes.body.email === 'aman@gmail.com' || memberMeRes.body.user?.email === 'aman@gmail.com'), 'GET /api/auth/me returns member profile');

    // ─────────────────────────────────────────────────────────────
    // CYCLE 3: Member Portal Experience
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- [CYCLE 3] Member Portal Cycle ---');

    // 3.1 Member Split
    const memberSplitRes = await req('/splits/me', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberSplitRes.status === 200, 'GET /api/splits/me returns 200');

    // 3.2 Member Diet
    const memberDietRes = await req('/diet/my', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberDietRes.status === 200, 'GET /api/diet/my returns 200');

    // 3.3 Member Progress (List & Create & Delete)
    const memberProgressRes = await req('/progress', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberProgressRes.status === 200, 'GET /api/progress returns 200');

    const memberProgressMeRes = await req('/progress/me', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberProgressMeRes.status === 200, 'GET /api/progress/me returns 200');

    const newProgressRes = await req('/progress', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: {
        date: new Date().toISOString(),
        weight: 75.5,
        bodyFat: 14.5,
        notes: 'Integration test cycle entry'
      }
    });
    assert(newProgressRes.status === 201 || newProgressRes.status === 200, 'POST /api/progress creates progress entry');
    const progressId = newProgressRes.body._id || newProgressRes.body.progress?._id;

    if (progressId) {
      const delProgressRes = await req(`/progress/${progressId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${memberToken}` }
      });
      assert(delProgressRes.status === 200, `DELETE /api/progress/${progressId} cleans up test progress`);
    }

    // 3.4 Member Notifications
    const memberNotifsRes = await req('/notifications', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberNotifsRes.status === 200, 'GET /api/notifications returns 200');

    // 3.5 Member Orders (List)
    const memberOrdersRes = await req('/orders/my', { headers: { Authorization: `Bearer ${memberToken}` } });
    assert(memberOrdersRes.status === 200, 'GET /api/orders/my returns 200');

    // 3.6 Member Checkout Order Creation
    const orderPayload = {
      items: [
        {
          product: sampleProductId,
          quantity: 1,
          price: 1500
        }
      ],
      shippingAddress: {
        fullName: 'Aman Gupta',
        addressLine1: 'Flat 402, Gym Towers',
        city: 'Indore',
        state: 'Madhya Pradesh',
        postalCode: '452001',
        phone: '9111111111'
      },
      paymentMethod: 'cod'
    };
    const createOrderRes = await req('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: orderPayload
    });
    console.log('createOrderRes status:', createOrderRes.status, 'body:', createOrderRes.body);
    assert(createOrderRes.status === 201 || createOrderRes.status === 200, 'POST /api/orders creates new order from member portal');
    const createdOrderId = createOrderRes.body._id || createOrderRes.body.order?._id;

    // ─────────────────────────────────────────────────────────────
    // CYCLE 4: Admin Management Flow
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- [CYCLE 4] Admin & Staff Management Flow ---');

    // 4.1 Analytics / Dashboard
    const analyticsRes = await req('/analytics', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(analyticsRes.status === 200, 'GET /api/analytics returns 200');

    const summaryRes = await req('/analytics/summary', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(summaryRes.status === 200, 'GET /api/analytics/summary returns 200');

    const revenueRes = await req('/analytics/revenue-full', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(revenueRes.status === 200, 'GET /api/analytics/revenue-full returns 200');

    // 4.2 Member List
    const membersRes = await req('/members?all=1', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(membersRes.status === 200 && Array.isArray(membersRes.body), 'GET /api/members?all=1 returns member list');

    // 4.3 Trainers List
    const trainersRes = await req('/trainers', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(trainersRes.status === 200 && Array.isArray(trainersRes.body), 'GET /api/trainers returns trainer list');

    // 4.4 Orders List & Status Update
    const ordersRes = await req('/orders', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(ordersRes.status === 200, 'GET /api/orders returns orders list for admin');

    if (createdOrderId) {
      const updateOrderRes = await req(`/orders/${createdOrderId}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status: 'confirmed' }
      });
      assert(updateOrderRes.status === 200, `PUT /api/orders/${createdOrderId}/status updates order status`);
    }

    // 4.5 Payments List & Record Payment
    const paymentsRes = await req('/payments', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(paymentsRes.status === 200, 'GET /api/payments returns payment records');

    const newPaymentRes = await req('/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        member: memberId,
        amount: 2500,
        plan: 'Pro',
        method: 'upi',
        date: new Date().toISOString()
      }
    });
    assert(newPaymentRes.status === 201 || newPaymentRes.status === 200, 'POST /api/payments records payment');
    const paymentId = newPaymentRes.body._id || newPaymentRes.body.payment?._id;

    // 4.6 Payment Receipt Generation
    if (paymentId) {
      const receiptRes = await req(`/payments/receipt/${paymentId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(receiptRes.status === 200, `GET /api/payments/receipt/${paymentId} generates PDF receipt`);
    }

    // 4.7 Enquiries List & Cleanup
    const enquiriesRes = await req('/enquiries', { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(enquiriesRes.status === 200, 'GET /api/enquiries returns lead list for admin');

    if (createdEnquiryId) {
      const delEnquiryRes = await req(`/enquiries/${createdEnquiryId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert(delEnquiryRes.status === 200, `DELETE /api/enquiries/${createdEnquiryId} cleans up test lead`);
    }

    console.log('\n====================================================');
    console.log(`🎉 COMPLETE CYCLE AUDIT PASSED! ${testResults.length}/${testResults.length} checks succeeded.`);
    console.log('====================================================');
  } finally {
    server.close();
    process.exit(0);
  }
}

runCompleteCycle().catch(err => {
  console.error('\n❌ FATAL LIFECYCLE AUDIT FAILURE:\n', err);
  process.exit(1);
});
