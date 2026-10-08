/**
 * Meta WhatsApp Cloud API Service.
 *
 * Official Cloud API sender using Meta Graph API (v21.0).
 * Reliable Meta Cloud API delivery:
 *  - Supports pre-approved templates (e.g. 'fitnation_by_ajeet' with {{1}} customerName and {{2}} daysRemaining)
 *  - Supports document attachments (PDF statements)
 *  - Supports free-form text messages (within 24-hour service window)
 *  - Handles exponential backoff retries on transient 429/5xx errors
 */

const axios = require('axios');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');

/**
 * Format any phone number into clean E.164 digits without '+' or symbols
 * as required by Meta Cloud API (e.g., '919589730151').
 */
function formatWhatsAppNumber(to) {
  if (!to) return null;
  let raw = String(to).trim();
  if (raw.startsWith('whatsapp:')) raw = raw.replace(/^whatsapp:/i, '');

  const cleaned = raw.replace(/[\s\-().+]/g, '');
  if (!cleaned) return null;

  // Leading '00' international prefix (e.g., 00919876543210 -> 919876543210)
  if (/^00\d{8,15}$/.test(cleaned)) {
    return cleaned.slice(2);
  }

  // 10-digit Indian mobile number starting with 6, 7, 8, 9
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `${DEFAULT_COUNTRY_CODE}${cleaned}`;
  }

  // 11-digit with leading 0 (e.g., 09876543210 -> 919876543210)
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    return `${DEFAULT_COUNTRY_CODE}${cleaned.slice(1)}`;
  }

  // Standard international number with country code (8 to 15 digits)
  if (/^\d{8,15}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

/** Check if a config string is missing or placeholder. */
function isPlaceholder(v) {
  return !v || /^(your_|ACxxxx|xxxx|PASTE_)/i.test(v);
}

/**
 * Check Meta WhatsApp credentials status.
 */
function whatsappStatus() {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME || 'fitnation_membership_alert';

  if (isPlaceholder(token)) {
    return { ok: false, reason: 'META_WHATSAPP_TOKEN missing or placeholder in .env' };
  }
  if (isPlaceholder(phoneId)) {
    return { ok: false, reason: 'META_PHONE_NUMBER_ID missing or placeholder in .env' };
  }

  return {
    ok: true,
    provider: 'meta_cloud_api',
    phoneId,
    templateName,
  };
}

function isWhatsAppConfigured() {
  return whatsappStatus().ok;
}

/** Human-readable explanation for common Meta Cloud API error codes. */
function explainMetaError(code, message) {
  switch (code) {
    case 131030:
      return 'Recipient phone number is not whitelisted in Meta Developer Dashboard (Development/Sandbox mode). Add this phone number to Test Numbers or verify your business in Meta Business Suite.';
    case 131026:
      return 'Message undeliverable. The recipient number may not have an active WhatsApp account or has blocked the business.';
    case 132000:
      return 'Template parameter count mismatch. The template requires different parameters than provided.';
    case 132001:
      return 'Template does not exist in the specified language (en). Verify template name in Meta Business Manager.';
    case 131047:
      return 'Re-engagement message failed or 24h window closed without an approved template.';
    case 190:
      return 'Meta Access Token is invalid or expired. Generate a Permanent System User Token in Meta Business Suite.';
    case 100:
      return 'Invalid parameter or Phone Number ID in Meta request.';
    case 80007:
      return 'Meta API rate limit exceeded. Please try again shortly.';
    default:
      return message || null;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Send a gym membership renewal reminder via Meta WhatsApp Cloud API template.
 *
 * @param {string} recipientPhone  Destination phone number (e.g. '919589730151')
 * @param {string} customerName    Member's full name (fills {{1}})
 * @param {number|string} daysRemaining Days left in membership or status phrase (fills {{2}})
 * @param {object} [opts]          Optional overrides (e.g. expiryDate fills {{3}})
 * @returns {Promise<{ok:boolean, channel:'whatsapp', messageId?:string, to?:string, error?:string}>}
 */
async function sendGymReminder(recipientPhone, customerName, daysRemaining = 5, opts = {}) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const templateName = opts.templateName || process.env.META_WHATSAPP_TEMPLATE_NAME || 'fitnation_membership_alert';
  const langCode = opts.languageCode || process.env.META_WHATSAPP_TEMPLATE_LANG || 'en';

  const status = whatsappStatus();
  if (!status.ok) {
    console.warn(`⚠️  WhatsApp skipped — ${status.reason}`);
    return { ok: false, channel: 'whatsapp', skipped: true, reason: status.reason };
  }

  const formattedTo = formatWhatsAppNumber(recipientPhone);
  if (!formattedTo) {
    return { ok: false, channel: 'whatsapp', skipped: true, reason: `Invalid phone number "${recipientPhone}"` };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;

  // Format {{2}} friendly string: "expires in X days", "expires today", or "expired X days ago"
  let statusText = String(daysRemaining ?? '0');
  if (typeof daysRemaining === 'number' || /^-?\d+$/.test(String(daysRemaining).trim())) {
    const num = Number(daysRemaining);
    if (num > 1) statusText = `expires in ${num} days`;
    else if (num === 1) statusText = 'expires in 1 day';
    else if (num === 0) statusText = 'expires today';
    else if (num === -1) statusText = 'expired 1 day ago';
    else statusText = `expired ${Math.abs(num)} days ago`;
  }

  // Format {{3}} expiration date
  let dateText = opts.expiryDate || opts.endDate;
  if (!dateText && opts.member?.membershipEnd) {
    dateText = new Date(opts.member.membershipEnd).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  if (!dateText) {
    dateText = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: formattedTo,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: langCode,
      },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: String(customerName || 'Athlete') },
            { type: 'text', text: String(statusText) },
            { type: 'text', text: String(dateText) },
          ],
        },
      ],
    },
  };

  try {
    const res = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const msgId = res.data?.messages?.[0]?.id;
    console.log(`🎉 Reminder sent successfully to ${customerName} (${formattedTo})! Message ID: ${msgId}`);
    return {
      ok: true,
      channel: 'whatsapp',
      messageId: msgId,
      to: formattedTo,
      provider: 'meta_cloud_api',
    };
  } catch (err) {
    const metaErr = err.response?.data?.error;
    const code = metaErr?.code || err.code;
    const msg = metaErr?.message || err.message;

    // If template not found in 'en', auto-retry with 'en_US' (Meta default for English templates)
    if (code === 132001 && payload.template?.language?.code === 'en') {
      try {
        const retryPayload = {
          ...payload,
          template: { ...payload.template, language: { code: 'en_US' } },
        };
        const retryRes = await axios.post(url, retryPayload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        });
        const retryMsgId = retryRes.data?.messages?.[0]?.id;
        console.log(`🎉 Reminder sent successfully with en_US template to ${customerName} (${formattedTo})! Message ID: ${retryMsgId}`);
        return {
          ok: true,
          channel: 'whatsapp',
          messageId: retryMsgId,
          to: formattedTo,
          provider: 'meta_cloud_api',
        };
      } catch (retryErr) {
        // Fall back to original error reporting
      }
    }

    const hint = explainMetaError(code, msg);

    console.error(`❌ Meta WhatsApp error for ${formattedTo} [${code}]: ${msg}`);
    if (hint) console.error(`   ↳ ${hint}`);

    return {
      ok: false,
      channel: 'whatsapp',
      to: formattedTo,
      code,
      error: msg,
      hint,
      provider: 'meta_cloud_api',
    };
  }
}

/**
 * Universal WhatsApp message dispatcher.
 * Handles templates (fitnation_by_ajeet), media attachments (PDF invoices), and fallback text.
 *
 * @param {string} to              Recipient phone number
 * @param {string} message         Notification text
 * @param {object} [opts]
 * @param {string} [opts.customerName] Member name for template {{1}}
 * @param {number|string} [opts.daysRemaining] Days left for template {{2}}
 * @param {string} [opts.mediaUrl]     Public PDF or image attachment URL
 * @param {string} [opts.filename]     Optional filename for document
 * @param {boolean} [opts.forceText]   Send freeform text instead of template
 * @param {number} [opts.retries=1]    Retry attempts on transient 429/5xx errors
 */
async function sendWhatsApp(to, message, opts = {}) {
  const {
    customerName,
    daysRemaining,
    mediaUrl,
    filename,
    forceText = false,
    retries = 1,
  } = opts;

  if (!to) return { ok: false, channel: 'whatsapp', skipped: true, reason: 'no phone number on record' };

  const status = whatsappStatus();
  if (!status.ok) {
    console.warn(`⚠️  WhatsApp skipped — ${status.reason}`);
    return { ok: false, channel: 'whatsapp', skipped: true, reason: status.reason };
  }

  const formattedTo = formatWhatsAppNumber(to);
  if (!formattedTo) {
    return { ok: false, channel: 'whatsapp', skipped: true, reason: `unparseable phone number "${to}"` };
  }

  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;

  // 1. If media attachment (e.g., PDF statement from payments route)
  if (mediaUrl) {
    const isPdf = /\.pdf(\?|$)/i.test(mediaUrl) || /statement/i.test(mediaUrl);
    const payload = {
      messaging_product: 'whatsapp',
      to: formattedTo,
      type: isPdf ? 'document' : 'image',
      [isPdf ? 'document' : 'image']: {
        link: mediaUrl,
        caption: message ? message.slice(0, 1024) : undefined,
        ...(isPdf ? { filename: filename || 'Payment-Statement.pdf' } : {}),
      },
    };

    try {
      const res = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      const msgId = res.data?.messages?.[0]?.id;
      console.log(`✅ WhatsApp media sent to ${formattedTo} (${msgId})`);
      return { ok: true, channel: 'whatsapp', messageId: msgId, to: formattedTo };
    } catch (err) {
      console.error(`❌ WhatsApp media failed for ${formattedTo}:`, err.response?.data?.error || err.message);
      // If media failed, continue to fallback below
    }
  }

  // 2. If this is explicitly a gym fee/expiration reminder (or template explicitly requested)
  const isGymReminder = Boolean(
    opts.isGymReminder ||
    opts.useTemplate ||
    opts.templateName ||
    (opts.daysRemaining !== undefined && !forceText)
  );

  const templateName = opts.templateName || process.env.META_WHATSAPP_TEMPLATE_NAME || 'fitnation_membership_alert';
  if (!forceText && isGymReminder && templateName) {
    const name = customerName || (opts.member?.name) || 'Athlete';
    const days = daysRemaining !== undefined ? daysRemaining : 5;
    const reminderResult = await sendGymReminder(formattedTo, name, days, opts);
    if (reminderResult.ok) return reminderResult;

    // If template failed due to pending review or 24h issue, try freeform text fallback
    console.warn(`⚠️  Template send failed, attempting freeform text fallback for ${formattedTo}...`);
  }

  // 3. Freeform text message
  const textPayload = {
    messaging_product: 'whatsapp',
    to: formattedTo,
    type: 'text',
    text: {
      preview_url: false,
      body: message ? message.slice(0, 4096) : 'Notification from FitNation',
    },
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(url, textPayload, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      const msgId = res.data?.messages?.[0]?.id;
      console.log(`✅ WhatsApp text sent to ${formattedTo} (${msgId})`);
      return { ok: true, channel: 'whatsapp', messageId: msgId, to: formattedTo };
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (attempt < retries && (status === 429 || status >= 500)) {
        const wait = 500 * (attempt + 1);
        console.warn(`↻ Meta WhatsApp retry ${attempt + 1}/${retries} in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  const metaErr = lastErr?.response?.data?.error;
  const code = metaErr?.code || lastErr?.code;
  const msg = metaErr?.message || lastErr?.message;
  const hint = explainMetaError(code, msg);

  console.error(`❌ Meta WhatsApp failed for ${formattedTo}: [${code}] ${msg}`);
  if (hint) console.error(`   ↳ ${hint}`);

  return {
    ok: false,
    channel: 'whatsapp',
    to: formattedTo,
    code,
    error: msg,
    hint,
  };
}

/**
 * Bulk send helper with concurrency control.
 *
 * @param {Array<{to:string, message:string, opts?:any, meta?:any}>} jobs
 * @param {number} [concurrency=5]
 */
async function sendBulkWhatsApp(jobs, concurrency = 5) {
  const results = new Array(jobs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const i = cursor++;
      const job = jobs[i];
      results[i] = { ...(await sendWhatsApp(job.to, job.message, job.opts)), meta: job.meta };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

/**
 * Verify Meta Cloud API connection without sending messages.
 */
async function verifyMetaWhatsApp() {
  const status = whatsappStatus();
  if (!status.ok) return { ...status, verified: false };

  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID;

  try {
    const res = await axios.get(`https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const data = res.data;
    return {
      ok: true,
      verified: true,
      verifiedName: data.verified_name,
      displayPhoneNumber: data.display_phone_number,
      qualityRating: data.quality_rating,
      codeVerificationStatus: data.code_verification_status,
      phoneId: data.id,
      platformType: data.platform_type,
      ...status,
    };
  } catch (err) {
    const metaErr = err.response?.data?.error;
    const msg = metaErr?.message || err.message;
    return {
      ok: false,
      verified: false,
      reason: `Meta Cloud API rejected credentials: ${msg}`,
      ...status,
    };
  }
}

module.exports = {
  sendWhatsApp,
  sendGymReminder,
  sendBulkWhatsApp,
  formatWhatsAppNumber,
  isWhatsAppConfigured,
  whatsappStatus,
  verifyMetaWhatsApp,
};
