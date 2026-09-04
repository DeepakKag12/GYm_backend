const PDFDocument = require('pdfkit');

const PLAN_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 };

function money(value) {
  return `INR ${Number(value || 0).toLocaleString('en-IN')}`;
}

function dateText(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-IN');
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

function buildMonthlyRows(member, paidTotal) {
  if (!member.membershipStart || !member.feeAmount) return [];
  const planMonths = PLAN_MONTHS[member.membershipPlan] || 1;
  const monthlyFee = Number(member.feeAmount) / planMonths;
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

function statementData(member, payments) {
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const recordedDue = member.feeDueAmount > 0
    ? Number(member.feeDueAmount)
    : member.feePaid === false ? Number(member.feeAmount || 0) : 0;
  const totalFee = Math.max(Number(member.feeAmount || 0), paidTotal + recordedDue);
  const due = Math.max(0, totalFee - paidTotal);
  const planMonths = PLAN_MONTHS[member.membershipPlan] || 1;
  const monthlyFee = Number(member.feeAmount || 0) / planMonths;

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

function buildMemberStatement(member, payments) {
  const summary = statementData(member, payments);
  const doc = new PDFDocument({ size: 'A4', margin: 42 });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(20).fillColor('#0f172a').text('FitNation by Ajeet', { continued: false });
  doc.fontSize(10).fillColor('#64748b').text('Member payment statement');
  doc.moveDown(1);

  doc.fontSize(13).fillColor('#0f172a').text(member.name || 'Member');
  doc.fontSize(10).fillColor('#334155')
    .text(`Email: ${member.email || '-'}`)
    .text(`Phone: ${member.phone || '-'}`)
    .text(`Statement date: ${dateText(new Date())}`);
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0f172a').text('Membership summary');
  doc.fontSize(10).fillColor('#334155')
    .text(`Plan: ${member.membershipPlan || '-'}`)
    .text(`Membership period: ${dateText(member.membershipStart)} - ${dateText(member.membershipEnd)}`)
    .text(`Member for: ${summary.memberMonths} month(s)`)
    .text(`Plan covers: ${summary.planMonths} month(s)`)
    .text(`Estimated months due: ${summary.dueMonths}`);
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#0f172a')
    .text(`Total fee: ${money(summary.totalFee)}`)
    .text(`Paid: ${money(summary.paidTotal)}`)
    .fillColor(summary.due > 0 ? '#b91c1c' : '#15803d')
    .text(`Remaining due: ${money(summary.due)}`);
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0f172a').text('Month-by-month balance');
  doc.moveDown(0.3);
  if (summary.monthlyRows.length) {
    summary.monthlyRows.forEach(row => {
      doc.fontSize(9).fillColor('#334155')
        .text(`${row.label}  |  Fee ${money(row.fee)}  |  Paid ${money(row.paid)}  |  Due ${money(row.due)}`);
    });
  } else {
    doc.fontSize(9).fillColor('#64748b').text('No membership period details available.');
  }
  doc.moveDown(1);

  doc.fontSize(12).fillColor('#0f172a').text('Payment history');
  doc.moveDown(0.3);
  if (payments.length) {
    payments.forEach(payment => {
      doc.fontSize(9).fillColor('#334155').text(
        `${dateText(payment.createdAt)}  |  ${money(payment.amount)}  |  ${(payment.method || 'cash').toUpperCase()}  |  ${payment.kind || 'payment'}`
      );
    });
  } else {
    doc.fontSize(9).fillColor('#64748b').text('No payments recorded.');
  }

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor('#64748b').text('Please keep this statement for your records. Contact the gym for corrections.');
  doc.end();
  return done;
}

module.exports = { buildMemberStatement, statementData };
