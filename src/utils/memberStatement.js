const PDFDocument = require('pdfkit');

// Force Vercel NFT (Node File Trace) to bundle standard fonts used by PDFKit
try {
  require('pdfkit/standard-fonts/Helvetica');
  require('pdfkit/standard-fonts/HelveticaBold');
  require('pdfkit/standard-fonts/HelveticaOblique');
  require('pdfkit/standard-fonts/HelveticaBoldOblique');
  require('pdfkit/standard-fonts/Courier');
  require('pdfkit/standard-fonts/TimesRoman');
} catch (_) {}

const PLAN_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 };

function money(value) {
  return `INR ${Number(value || 0).toLocaleString('en-IN')}`;
}

function dateText(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch (_) {
    return String(value);
  }
}

function dateTimeText(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (_) {
    return String(value);
  }
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function monthCount(start, end = new Date()) {
  if (!start) return 0;
  const from = new Date(start);
  const to = new Date(end);
  return Math.max(1, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + (to.getDate() >= from.getDate() ? 0 : -1));
}

const STANDARD_PLAN_PRICES = { monthly: 1500, quarterly: 3500, 'half-yearly': 6000, yearly: 10000 };

function buildMonthlyRows(member, paidTotal) {
  if (!member.membershipStart) return [];
  const planMonths = PLAN_MONTHS[member.membershipPlan] || 1;
  const defaultFee = STANDARD_PLAN_PRICES[member.membershipPlan] || 1500;
  const totalPlanFee = Number(member.feeAmount || 0) > 0 ? Number(member.feeAmount) : defaultFee;
  const monthlyFee = totalPlanFee / planMonths;
  let remainingPaid = Number(paidTotal || 0);
  const rows = [];
  const start = new Date(member.membershipStart);

  for (let index = 0; index < planMonths; index += 1) {
    const periodStart = addMonths(start, index);
    const periodEnd = addMonths(start, index + 1);
    const paid = Math.min(monthlyFee, remainingPaid);
    remainingPaid = Math.max(0, remainingPaid - paid);
    rows.push({
      label: periodStart.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      period: `${dateText(periodStart)} - ${dateText(periodEnd)}`,
      fee: monthlyFee,
      paid,
      due: Math.max(0, monthlyFee - paid),
    });
  }
  return rows;
}

function statementData(member, payments = []) {
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const defaultPlanFee = STANDARD_PLAN_PRICES[member.membershipPlan] || 1500;
  const baseFee = Number(member.feeAmount || 0) > 0 ? Number(member.feeAmount) : defaultPlanFee;
  const recordedDue = member.feeDueAmount > 0
    ? Number(member.feeDueAmount)
    : member.feePaid === false ? baseFee : 0;
  const totalFee = Math.max(baseFee, paidTotal + recordedDue);
  const due = Math.max(0, totalFee - paidTotal);
  const planMonths = PLAN_MONTHS[member.membershipPlan] || 1;
  const monthlyFee = baseFee / planMonths;

  return {
    paidTotal,
    totalFee,
    due,
    planMonths,
    monthlyFee,
    memberMonths: monthCount(member.membershipStart),
    dueMonths: monthlyFee > 0 ? Math.ceil(due / monthlyFee) : 0,
    monthlyRows: buildMonthlyRows(member, paidTotal),
  };
}

/** Draws standard gym branding header across all documents */
function drawGymHeader(doc, { title, docNumber, dateStr, gym }) {
  const gymName = gym?.gymName || 'FitNation by Ajeet';
  const gymPhone = gym?.phone || '9630906906';
  const gymEmail = gym?.email || 'contact@fitnation.in';
  const gymAddress = gym?.address || 'FitNation Gym, Indore, MP';

  // Left side: Gym Branding
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f172a').text(gymName, 40, 40, { width: 300 });
  const gymUpi = gym?.upiId ? `  |  UPI: ${gym.upiId}` : '';
  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text(gym?.tagline || 'Uniting a healthier world', 40, 62);
  doc.fontSize(8).fillColor('#475569')
    .text(`Phone: ${gymPhone}  |  Email: ${gymEmail}${gymUpi}`, 40, 75)
    .text(gymAddress, 40, 87);

  // Right side: Document Title Box
  doc.rect(360, 38, 195, 58).fillColor('#f8fafc').fill();
  doc.rect(360, 38, 195, 58).lineWidth(1).strokeColor('#e2e8f0').stroke();

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#0284c7').text(title, 370, 46, { width: 175, align: 'right' });
  if (docNumber) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a').text(`Ref: ${docNumber}`, 370, 62, { width: 175, align: 'right' });
  }
  doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Date: ${dateStr || dateText(new Date())}`, 370, 76, { width: 175, align: 'right' });

  // Divider
  doc.moveTo(40, 106).lineTo(555, 106).lineWidth(1).strokeColor('#cbd5e1').stroke();
  return 118; // Next usable Y
}

/** Draws common footer */
function drawFooter(doc) {
  const y = 785;
  doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
  doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
    .text('Thank you for choosing FitNation. This is a computer-generated document and requires no physical signature.', 40, y + 6, {
      width: 515,
      align: 'center',
    });
}

/** 1. MEMBERSHIP STATEMENT PDF */
function buildMemberStatement(member, payments = [], gymSettings = null) {
  const summary = statementData(member, payments);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const memberId = member._id ? String(member._id).slice(-6).toUpperCase() : 'MEM';
  let y = drawGymHeader(doc, {
    title: 'STATEMENT OF ACCOUNT',
    docNumber: `STM-${memberId}`,
    dateStr: dateText(new Date()),
    gym: gymSettings,
  });

  // Member details box
  doc.rect(40, y, 515, 62).fillColor('#f8fafc').fill();
  doc.rect(40, y, 515, 62).lineWidth(0.75).strokeColor('#e2e8f0').stroke();

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('MEMBER DETAILS', 50, y + 8);
  doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
    .text(`Name: ${member.name || '-'}`, 50, y + 24)
    .text(`Phone: ${member.phone || '-'}`, 50, y + 36)
    .text(`Email: ${member.email || '-'}`, 50, y + 48);

  doc.fontSize(8.5).fillColor('#334155')
    .text(`Plan: ${(member.membershipPlan || 'Monthly').toUpperCase()}`, 300, y + 24)
    .text(`Period: ${dateText(member.membershipStart)} to ${dateText(member.membershipEnd)}`, 300, y + 36)
    .text(`Status: ${member.feePaid ? 'Fully Paid' : 'Fee Pending'}`, 300, y + 48);

  y += 74;

  // Financial Summary Cards
  const cardW = 165;
  // Total Fee Card
  doc.rect(40, y, cardW, 46).fillColor('#f1f5f9').fill();
  doc.fontSize(8).font('Helvetica').fillColor('#64748b').text('TOTAL MEMBERSHIP FEE', 48, y + 8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a').text(money(summary.totalFee), 48, y + 22);

  // Paid Card
  doc.rect(215, y, cardW, 46).fillColor('#ecfdf5').fill();
  doc.fontSize(8).font('Helvetica').fillColor('#059669').text('TOTAL AMOUNT PAID', 223, y + 8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#047857').text(money(summary.paidTotal), 223, y + 22);

  // Due Card
  const dueBg = summary.due > 0 ? '#fef2f2' : '#f0fdf4';
  const dueColor = summary.due > 0 ? '#b91c1c' : '#15803d';
  doc.rect(390, y, cardW, 46).fillColor(dueBg).fill();
  doc.fontSize(8).font('Helvetica').fillColor(dueColor).text('OUTSTANDING DUE', 398, y + 8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(dueColor).text(money(summary.due), 398, y + 22);

  y += 58;

  // Monthly Breakdown Section
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('MONTH-BY-MONTH BREAKDOWN', 40, y);
  y += 14;

  // Table header
  doc.rect(40, y, 515, 20).fillColor('#e2e8f0').fill();
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
    .text('MONTH / PERIOD', 48, y + 5)
    .text('PLAN FEE', 260, y + 5, { width: 80, align: 'right' })
    .text('PAID', 360, y + 5, { width: 80, align: 'right' })
    .text('DUE', 460, y + 5, { width: 85, align: 'right' });
  y += 20;

  if (summary.monthlyRows.length > 0) {
    summary.monthlyRows.forEach((row, i) => {
      if (y > 720) { doc.addPage(); y = 50; }
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(40, y, 515, 18).fillColor(bg).fill();
      doc.fontSize(8).font('Helvetica').fillColor('#334155')
        .text(`${row.label} (${row.period})`, 48, y + 4)
        .text(money(row.fee), 260, y + 4, { width: 80, align: 'right' })
        .text(money(row.paid), 360, y + 4, { width: 80, align: 'right' })
        .fillColor(row.due > 0 ? '#b91c1c' : '#15803d')
        .text(money(row.due), 460, y + 4, { width: 85, align: 'right' });
      y += 18;
    });
  } else {
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text('No periodic plan breakdown available.', 48, y + 6);
    y += 20;
  }

  y += 14;

  // Payment History Section
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('PAYMENT HISTORY', 40, y);
  y += 14;

  // Table header
  doc.rect(40, y, 515, 20).fillColor('#e2e8f0').fill();
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
    .text('DATE', 48, y + 5)
    .text('METHOD', 160, y + 5)
    .text('PARTICULARS', 270, y + 5)
    .text('AMOUNT', 460, y + 5, { width: 85, align: 'right' });
  y += 20;

  if (payments.length > 0) {
    payments.forEach((payment, i) => {
      if (y > 720) { doc.addPage(); y = 50; }
      const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(40, y, 515, 18).fillColor(bg).fill();
      doc.fontSize(8).font('Helvetica').fillColor('#334155')
        .text(dateText(payment.createdAt), 48, y + 4)
        .text((payment.method || 'cash').toUpperCase(), 160, y + 4)
        .text(payment.note || (payment.kind || 'Payment').toUpperCase(), 270, y + 4, { width: 180, ellipsis: true })
        .font('Helvetica-Bold').fillColor('#047857')
        .text(money(payment.amount), 460, y + 4, { width: 85, align: 'right' });
      y += 18;
    });
  } else {
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text('No payments recorded yet.', 48, y + 6);
    y += 20;
  }

  drawFooter(doc);
  doc.end();
  return done;
}

/** 2. PAYMENT RECEIPT PDF */
function buildPaymentReceipt(payment, member = {}, gymSettings = null) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const receiptId = payment._id ? String(payment._id).slice(-8).toUpperCase() : 'REC';
  let y = drawGymHeader(doc, {
    title: 'PAYMENT RECEIPT',
    docNumber: `REC-${receiptId}`,
    dateStr: dateTimeText(payment.createdAt),
    gym: gymSettings,
  });

  // Received From Box
  doc.rect(40, y, 515, 66).fillColor('#f8fafc').fill();
  doc.rect(40, y, 515, 66).lineWidth(0.75).strokeColor('#e2e8f0').stroke();

  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('RECEIVED FROM', 50, y + 8);
  doc.fontSize(9).font('Helvetica').fillColor('#334155')
    .text(`Member Name: ${member.name || 'Member'}`, 50, y + 26)
    .text(`Phone: ${member.phone || '-'}`, 50, y + 39)
    .text(`Email: ${member.email || '-'}`, 50, y + 52);

  doc.fontSize(9).fillColor('#334155')
    .text(`Membership Plan: ${(member.membershipPlan || 'Standard').toUpperCase()}`, 300, y + 26)
    .text(`Period: ${dateText(payment.periodStart || member.membershipStart)} to ${dateText(payment.periodEnd || member.membershipEnd)}`, 300, y + 39)
    .text(`Payment Mode: ${(payment.method || 'cash').toUpperCase()}`, 300, y + 52);

  y += 78;

  // Receipt Details Table
  doc.rect(40, y, 515, 22).fillColor('#e2e8f0').fill();
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#0f172a')
    .text('DESCRIPTION / PARTICULARS', 50, y + 6)
    .text('PAYMENT TYPE', 300, y + 6)
    .text('AMOUNT PAID', 450, y + 6, { width: 95, align: 'right' });

  y += 22;

  const kindLabel = {
    'new-membership': 'New Membership Joining Fee',
    renewal: 'Membership Renewal Fee',
    adjustment: 'Fee Due Settlement / Adjustment',
    order: 'Gym Store Purchase',
  }[payment.kind] || 'Membership Fee Payment';

  doc.rect(40, y, 515, 48).fillColor('#ffffff').fill();
  doc.rect(40, y, 515, 48).lineWidth(0.5).strokeColor('#e2e8f0').stroke();

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(kindLabel, 50, y + 10);
  if (payment.note) {
    doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(`Note: ${payment.note}`, 50, y + 24, { width: 230 });
  }

  doc.fontSize(8.5).font('Helvetica').fillColor('#334155').text((payment.source || 'Membership').toUpperCase(), 300, y + 10);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#047857').text(money(payment.amount), 450, y + 10, { width: 95, align: 'right' });

  y += 60;

  // Summary Card
  const remainingDue = Number(member.feeDueAmount || 0);
  doc.rect(280, y, 275, 75).fillColor('#f8fafc').fill();
  doc.rect(280, y, 275, 75).lineWidth(0.75).strokeColor('#cbd5e1').stroke();

  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('Amount Received:', 295, y + 12);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#047857').text(money(payment.amount), 430, y + 12, { width: 110, align: 'right' });

  doc.fontSize(9).font('Helvetica').fillColor('#64748b').text('Remaining Member Due:', 295, y + 32);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(remainingDue > 0 ? '#b91c1c' : '#15803d')
    .text(money(remainingDue), 430, y + 32, { width: 110, align: 'right' });

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text('Payment Status:', 295, y + 52);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0284c7').text('CONFIRMED & RECEIVED', 410, y + 52, { width: 130, align: 'right' });

  y += 95;

  // Authorized Stamp Section
  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b')
    .text('Recorded By: Gym Admin Desk', 50, y)
    .text(`Transaction Reference: ${payment._id}`, 50, y + 14);

  doc.rect(380, y - 10, 175, 45).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
  doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8').text('Authorized Signatory / Seal', 380, y + 25, { width: 175, align: 'center' });

  drawFooter(doc);
  doc.end();
  return done;
}

/** 3. ORDER INVOICE PDF */
function buildOrderInvoice(order, user = {}, gymSettings = null) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const orderNum = order._id ? String(order._id).slice(-6).toUpperCase() : 'ORD';
  let y = drawGymHeader(doc, {
    title: 'STORE TAX INVOICE',
    docNumber: `INV-${orderNum}`,
    dateStr: dateTimeText(order.createdAt),
    gym: gymSettings,
  });

  // Customer & Pickup Details
  doc.rect(40, y, 515, 66).fillColor('#f8fafc').fill();
  doc.rect(40, y, 515, 66).lineWidth(0.75).strokeColor('#e2e8f0').stroke();

  const customerName = order.shippingAddress?.name || user?.name || 'Customer';
  const customerPhone = order.shippingAddress?.phone || user?.phone || '-';

  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('CUSTOMER & PICKUP DETAILS', 50, y + 8);
  doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
    .text(`Customer: ${customerName}`, 50, y + 24)
    .text(`Phone: ${customerPhone}`, 50, y + 36)
    .text(`Fulfillment: Collect from Gym Counter`, 50, y + 48);

  const statusLabel = (order.orderStatus || 'placed').toUpperCase();
  const paymentLabel = (order.paymentStatus || 'pending').toUpperCase();

  doc.fontSize(8.5).fillColor('#334155')
    .text(`Payment Method: ${(order.paymentMethod || 'cod').toUpperCase()}`, 300, y + 24)
    .text(`Payment Status: ${paymentLabel}`, 300, y + 36)
    .text(`Order Status: ${statusLabel}`, 300, y + 48);

  y += 76;

  // Order Items Table Header
  doc.rect(40, y, 515, 20).fillColor('#e2e8f0').fill();
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#1e293b')
    .text('#', 48, y + 5)
    .text('PRODUCT / ITEM', 75, y + 5)
    .text('VARIANT', 280, y + 5)
    .text('QTY', 360, y + 5, { width: 40, align: 'center' })
    .text('UNIT PRICE', 410, y + 5, { width: 65, align: 'right' })
    .text('TOTAL', 480, y + 5, { width: 65, align: 'right' });

  y += 20;

  const items = order.items || [];
  items.forEach((item, index) => {
    if (y > 720) { doc.addPage(); y = 50; }
    const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
    doc.rect(40, y, 515, 20).fillColor(bg).fill();

    const spec = [item.flavor, item.weight].filter(Boolean).join(' / ') || '-';
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 1);

    doc.fontSize(8).font('Helvetica').fillColor('#334155')
      .text(String(index + 1), 48, y + 5)
      .text(item.name || 'Product', 75, y + 5, { width: 200, ellipsis: true })
      .text(spec, 280, y + 5, { width: 75, ellipsis: true })
      .text(String(item.quantity || 1), 360, y + 5, { width: 40, align: 'center' })
      .text(money(item.price), 410, y + 5, { width: 65, align: 'right' })
      .font('Helvetica-Bold')
      .text(money(itemTotal), 480, y + 5, { width: 65, align: 'right' });

    y += 20;
  });

  y += 12;

  // Bill Totals Summary
  doc.rect(320, y, 235, 70).fillColor('#f8fafc').fill();
  doc.rect(320, y, 235, 70).lineWidth(0.75).strokeColor('#cbd5e1').stroke();

  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text('Subtotal:', 335, y + 10);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(money(order.totalAmount), 445, y + 10, { width: 100, align: 'right' });

  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b').text('Delivery (Gym Pickup):', 335, y + 26);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#059669').text('FREE', 445, y + 26, { width: 100, align: 'right' });

  doc.moveTo(335, y + 42).lineTo(545, y + 42).lineWidth(0.5).strokeColor('#cbd5e1').stroke();

  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a').text('Total Payable:', 335, y + 48);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#0284c7').text(money(order.totalAmount), 445, y + 48, { width: 100, align: 'right' });

  y += 85;

  // Pickup Instructions & Notes
  doc.rect(40, y, 260, 48).fillColor('#f1f5f9').fill();
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155').text('PICKUP INSTRUCTIONS:', 48, y + 6);
  doc.fontSize(7.5).font('Helvetica').fillColor('#64748b')
    .text('Please present this invoice or your order number at the gym reception desk during working hours to collect your items.', 48, y + 18, { width: 245 });

  drawFooter(doc);
  doc.end();
  return done;
}

module.exports = {
  buildMemberStatement,
  buildPaymentReceipt,
  buildOrderInvoice,
  statementData,
};
