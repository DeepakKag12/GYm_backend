/**
 * Email sender (nodemailer).
 *
 * `nodemailer` was already a dependency but nothing in the codebase ever sent an
 * email — every notification went out over WhatsApp only, so a member with a bad
 * or un-joined number received nothing at all. This is the second delivery leg.
 *
 * Config, in priority order:
 *   1. SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   (any provider)
 *   2. EMAIL_USER / EMAIL_PASS                          (Gmail; use an App Password)
 * If neither is set, every send is skipped cleanly — it never throws and never
 * blocks the WhatsApp leg.
 */
const { renderEmail } = require('./emailTemplate');

let cachedTransport;
let cachedTransportKey;

function isPlaceholder(v) {
  return !v || /^(your|your_|user@|test@|smtp\.example)/i.test(v);
}

/**
 * Work out which SMTP account to use, in priority order:
 *   1. SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS     — any provider
 *   2. BREVO_SMTP_HOST / …_PORT / …_USER / …_PASS        — Brevo (Sendinblue)
 *   3. EMAIL_USER / EMAIL_PASS                            — Gmail app password
 *
 * The "from" address is deliberately NOT the SMTP username. Brevo logs you in
 * as something like a2be4c001@smtp-brevo.com, which is a relay login and not a
 * mailbox — mail sent from it is rejected or lands in spam. BREVO_FROM_EMAIL
 * (a sender you verified in the Brevo dashboard) is what recipients must see.
 */
function resolveEmailConfig() {
  const generic = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    label: 'SMTP_*',
  };
  const brevo = {
    host: process.env.BREVO_SMTP_HOST,
    port: Number(process.env.BREVO_SMTP_PORT || 587),
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
    label: 'BREVO_SMTP_*',
  };
  const gmail = {
    service: 'gmail',
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    label: 'EMAIL_USER (gmail)',
  };

  const chosen =
    (!isPlaceholder(generic.host) && !isPlaceholder(generic.user) && !isPlaceholder(generic.pass) && generic) ||
    (!isPlaceholder(brevo.host)   && !isPlaceholder(brevo.user)   && !isPlaceholder(brevo.pass)   && brevo) ||
    (!isPlaceholder(gmail.user)   && !isPlaceholder(gmail.pass)   && gmail) ||
    null;

  if (!chosen) return null;

  chosen.from =
    process.env.EMAIL_FROM ||
    process.env.BREVO_FROM_EMAIL ||
    (chosen.service === 'gmail' ? chosen.user : null) ||
    chosen.user;

  return chosen;
}

/** Shared config check for the send path and the health endpoint. */
function emailStatus() {
  const cfg = resolveEmailConfig();
  if (!cfg) {
    return {
      ok: false,
      reason: 'No SMTP credentials. Set BREVO_SMTP_HOST/PORT/USER/PASS (or SMTP_*, or EMAIL_USER + EMAIL_PASS).',
    };
  }
  if (!cfg.from) {
    return { ok: false, reason: 'No sender address. Set BREVO_FROM_EMAIL (or EMAIL_FROM) to a verified sender.' };
  }
  return { ok: true, from: cfg.from, transport: cfg.service || `${cfg.host}:${cfg.port}`, via: cfg.label };
}

function isEmailConfigured() {
  return emailStatus().ok;
}

function getTransport() {
  const cfg = resolveEmailConfig();
  const key = `${cfg.service || cfg.host}:${cfg.port}:${cfg.user}`;

  if (!cachedTransport || cachedTransportKey !== key) {
    const nodemailer = require('nodemailer');
    cachedTransport = nodemailer.createTransport(
      cfg.service
        ? { service: cfg.service, auth: { user: cfg.user, pass: cfg.pass }, pool: true, maxConnections: 3 }
        : {
            host: cfg.host,
            port: cfg.port,
            secure: cfg.port === 465,   // 465 = implicit TLS; 587 = STARTTLS
            auth: { user: cfg.user, pass: cfg.pass },
            pool: true,                 // one connection reused across a bulk sweep
            maxConnections: 3,
            maxMessages: 50,
          }
    );
    cachedTransportKey = key;
  }
  return cachedTransport;
}

/** Verify SMTP credentials once per process; logged, never fatal. */
async function verifyTransport() {
  const status = emailStatus();
  if (!status.ok) return status;
  try {
    await getTransport().verify();
    return { ok: true, verified: true, ...status };
  } catch (err) {
    return { ok: false, reason: `SMTP verify failed: ${err.message}` };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Send one email.
 *
 * @param {string} to        Recipient address
 * @param {string} subject
 * @param {object} content
 * @param {string} [content.text]   Plain-text body (falls back to `message`)
 * @param {string} [content.html]   Full HTML body; if omitted, the branded
 *                                  template is rendered from title/text
 * @param {string} [content.title]  Heading used by the branded template
 * @param {string} [content.ctaText] / [content.ctaUrl]  Optional button
 * @param {number} [content.retries=1]
 * @returns {Promise<{ok:boolean, channel:'email', skipped?:boolean, reason?:string,
 *                     messageId?:string, to?:string, error?:string}>}
 */
async function sendEmail(to, subject, content = {}) {
  const { text, html, title, ctaText, ctaUrl, retries = 1 } = content;

  if (!to) return { ok: false, channel: 'email', skipped: true, reason: 'no email address on record' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to).trim())) {
    return { ok: false, channel: 'email', skipped: true, reason: `invalid email address "${to}"` };
  }
  if (!subject) return { ok: false, channel: 'email', skipped: true, reason: 'empty subject' };

  const status = emailStatus();
  if (!status.ok) {
    console.warn(`⚠️  Email skipped — ${status.reason}`);
    return { ok: false, channel: 'email', skipped: true, reason: status.reason };
  }

  const body = html || renderEmail({ title: title || subject, message: text || '', ctaText, ctaUrl });
  const fromName = process.env.EMAIL_FROM_NAME || 'FitNation by Ajeet';
  const fromAddr = status.from;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const info = await getTransport().sendMail({
        from: `"${fromName}" <${fromAddr}>`,
        to,
        subject,
        text: text || subject,          // plain-text part for deliverability
        html: body,
        replyTo: process.env.EMAIL_REPLY_TO || undefined,
      });
      console.log(`✅ Email sent to ${to} (${info.messageId})`);
      return { ok: true, channel: 'email', messageId: info.messageId, to };
    } catch (err) {
      lastErr = err;
      // Connection-level hiccups are worth one more shot; auth failures are not.
      const retryable = ['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS'].includes(err.code);
      if (attempt < retries && retryable) {
        await sleep(500);
        continue;
      }
      break;
    }
  }

  console.error(`❌ Email failed for ${to}: [${lastErr.code}] ${lastErr.message}`);
  if (lastErr.code === 'EAUTH') {
    console.error('   ↳ Gmail rejects your normal password — create an App Password at myaccount.google.com/apppasswords');
  }
  return { ok: false, channel: 'email', to, code: lastErr.code, error: lastErr.message };
}

/** Fan out with bounded concurrency (the pooled transport does the rest). */
async function sendBulkEmail(jobs, concurrency = 5) {
  const results = new Array(jobs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const i = cursor++;
      const job = jobs[i];
      results[i] = { ...(await sendEmail(job.to, job.subject, job.content)), meta: job.meta };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

module.exports = { sendEmail, sendBulkEmail, isEmailConfigured, emailStatus, verifyTransport };
