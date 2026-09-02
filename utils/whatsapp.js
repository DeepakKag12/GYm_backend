/**
 * Twilio WhatsApp sender.
 *
 * Improvements over the first version:
 *  - One lazily-created Twilio client reused across calls (the old code called
 *    require('twilio') + twilio(sid, token) on *every* message, which rebuilt the
 *    HTTP agent each time and killed connection reuse on bulk sends).
 *  - Returns a structured result instead of a bare boolean, so callers can record
 *    the message SID / error code on the Notification document.
 *  - Retries transient failures (429 / 5xx / Twilio 20429, 20500, 20503) with
 *    exponential backoff instead of dropping the message.
 *  - Supports a Messaging Service SID and WhatsApp *content templates*, which is
 *    what you need to message a user outside the 24-hour session window.
 *  - Bulk send with bounded concurrency so a 500-member sweep doesn't trip
 *    Twilio's per-second rate limit.
 *
 * NOTE: sendWhatsApp() now resolves to an object, not a boolean. Truthiness is no
 * longer a success check — read `.ok`.
 */

const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');
const WHATSAPP_BODY_LIMIT = 1600; // Twilio hard limit for a WhatsApp body

/** Twilio error codes worth retrying — everything else is a permanent failure. */
const RETRYABLE_TWILIO_CODES = new Set([20429, 20500, 20503, 30001]);

let cachedClient;      // twilio client singleton
let cachedClientKey;   // sid:token the singleton was built with (so rotated creds rebuild it)

/**
 * Format a phone number to WhatsApp E.164 (`whatsapp:+<country><number>`).
 *  - Already prefixed with 'whatsapp:' → returned untouched
 *  - Starts with '+' → used as-is
 *  - 10-digit Indian mobile (6/7/8/9) → prefixed with the default country code
 *  - Leading 0 (0XXXXXXXXXX) → 0 stripped, country code prepended
 *  - Leading 00 international prefix (0091…) → converted to '+'
 */
function formatWhatsAppNumber(to) {
  if (!to) return null;
  const raw = String(to).trim();
  if (raw.startsWith('whatsapp:')) return raw;

  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return `whatsapp:${cleaned}`;
  if (/^00\d{8,15}$/.test(cleaned)) return `whatsapp:+${cleaned.slice(2)}`;
  if (/^[6-9]\d{9}$/.test(cleaned)) return `whatsapp:+${DEFAULT_COUNTRY_CODE}${cleaned}`;
  if (/^0[6-9]\d{9}$/.test(cleaned)) return `whatsapp:+${DEFAULT_COUNTRY_CODE}${cleaned.slice(1)}`;
  if (/^\d{8,15}$/.test(cleaned)) return `whatsapp:+${cleaned}`;
  return null; // not a number we can dial — caller reports it as skipped
}

/** Placeholder values from .env.example that must not be treated as real config. */
function isPlaceholder(v) {
  return !v || /^(your_|ACxxxx|xxxx|SKxxxx)/i.test(v);
}

/**
 * Twilio accepts two credential styles and this backend supports both:
 *
 *   TWILIO_AUTH_TOKEN                    — the account's primary auth token
 *   TWILIO_API_KEY + TWILIO_API_SECRET   — a scoped API key, whose SID starts
 *                                          with "SK" (recommended by Twilio,
 *                                          because it can be revoked on its own)
 *
 * Auth token wins when both are present. A TWILIO_API_KEY that is not
 * SK-prefixed is almost always an auth token pasted into the wrong variable —
 * that is the single most common cause of error 20003 — so it is used as one,
 * with a warning, rather than failing silently.
 */
function resolveTwilioAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const key = process.env.TWILIO_API_KEY;
  const secret = process.env.TWILIO_API_SECRET;

  if (!isPlaceholder(token)) {
    return { username: accountSid, password: token, accountSid, style: 'auth token' };
  }
  if (!isPlaceholder(key) && !isPlaceholder(secret)) {
    if (/^SK[0-9a-f]{32}$/i.test(key)) {
      return { username: key, password: secret, accountSid, style: 'API key' };
    }
    if (/^[0-9a-f]{32}$/i.test(key)) {
      return {
        username: accountSid,
        password: key,
        accountSid,
        style: 'auth token (from TWILIO_API_KEY)',
        warning: 'TWILIO_API_KEY is not an API Key SID (those start with "SK") — using it as TWILIO_AUTH_TOKEN. Rename it to TWILIO_AUTH_TOKEN, or create an API key at console.twilio.com → Account → API keys.',
      };
    }
    return { error: 'TWILIO_API_KEY is neither an API Key SID (SK…) nor a 32-character auth token' };
  }
  return { error: 'Set TWILIO_AUTH_TOKEN, or TWILIO_API_KEY + TWILIO_API_SECRET' };
}

let warnedOnce = false;

/**
 * Is WhatsApp usable right now? Returns { ok, reason } so the health endpoint and
 * the send path share one source of truth.
 */
function whatsappStatus() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (isPlaceholder(sid)) return { ok: false, reason: 'TWILIO_ACCOUNT_SID missing or placeholder' };
  if (!/^AC[0-9a-f]{32}$/i.test(sid)) return { ok: false, reason: 'TWILIO_ACCOUNT_SID must be an AC… account SID' };

  const auth = resolveTwilioAuth();
  if (auth.error) return { ok: false, reason: auth.error };

  // Twilio's Test credentials are a different SID/token pair that accepts calls
  // and returns plausible-looking responses but never delivers anything. It
  // looks identical to a working setup until a message fails to arrive, so it
  // is worth naming explicitly wherever we can detect it.
  if (process.env.TWILIO_CREDENTIALS_ARE_TEST === 'true') {
    return { ok: false, reason: 'TWILIO_CREDENTIALS_ARE_TEST is set — test credentials never deliver messages' };
  }

  if (isPlaceholder(from) && isPlaceholder(service)) {
    return { ok: false, reason: 'Set TWILIO_WHATSAPP_FROM (e.g. whatsapp:+14155238886) or TWILIO_MESSAGING_SERVICE_SID' };
  }
  if (auth.warning && !warnedOnce) {
    warnedOnce = true;
    console.warn(`⚠️  Twilio: ${auth.warning}`);
  }
  return {
    ok: true,
    from: from || `messaging-service:${service}`,
    auth: auth.style,
    warning: auth.warning,
  };
}

function isWhatsAppConfigured() {
  return whatsappStatus().ok;
}

function getClient() {
  const auth = resolveTwilioAuth();
  const key = `${auth.username}:${auth.password}`;
  if (!cachedClient || cachedClientKey !== key) {
    const twilio = require('twilio');
    cachedClient = twilio(auth.username, auth.password, {
      // API-key credentials need the account SID passed explicitly, since the
      // username is the key SID rather than the account.
      accountSid: auth.accountSid,
      autoRetry: true,
      maxRetries: 1,
    });
    cachedClientKey = key;
  }
  return cachedClient;
}

/** Verify the credentials without sending anything (used by the test script). */
async function verifyTwilio() {
  const status = whatsappStatus();
  if (!status.ok) return status;
  try {
    const acc = await getClient().api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    return { ok: true, verified: true, account: acc.friendlyName, accountStatus: acc.status, ...status };
  } catch (err) {
    return { ok: false, reason: `Twilio rejected the credentials: [${err.code}] ${err.message}`, ...status, verified: false };
  }
}

/** Human-readable hint for the Twilio error codes that actually show up in practice. */
function explain(code) {
  switch (code) {
    case 21211: return 'Invalid "to" number — store member phones as +91XXXXXXXXXX';
    case 63007: return 'TWILIO_WHATSAPP_FROM is not a WhatsApp sender on this account. On a trial account use the sandbox number whatsapp:+14155238886 (and have each recipient send "join <keyword>" to it first); a normal Twilio phone number is NOT WhatsApp-enabled until you register it as a WhatsApp sender.';
    case 63016: return 'Free-form message outside the session window. Sandbox: the recipient must WhatsApp "join <keyword>" to +14155238886 first. Production: send an approved template (TWILIO_WHATSAPP_TEMPLATE_SID).';
    case 63015: return 'No open 24-hour session with this recipient. WhatsApp only allows free-form text within 24 h of the user\'s last message; outside that you must send an approved template — set TWILIO_WHATSAPP_TEMPLATE_SID. On the sandbox, the recipient must first WhatsApp "join <keyword>" to +14155238886.';
    case 63018: return 'Rate limited by WhatsApp for this recipient';
    case 20003: return 'Twilio rejected the credentials — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (an API key must be the SK… SID plus its secret)';
    case 20008: return 'These are Twilio TEST credentials, which never deliver a real message. Console → Account → API keys & tokens has two pairs: copy the LIVE Account SID and Auth Token into TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.';
    case 21608: return 'Trial account: the recipient is not a verified number, or the "from" number is not WhatsApp-enabled';
    case 21610: return 'Recipient has blocked/unsubscribed from this sender';
    default: return null;
  }
}

function isRetryable(err) {
  if (RETRYABLE_TWILIO_CODES.has(err.code)) return true;
  return err.status === 429 || (err.status >= 500 && err.status < 600);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Send one WhatsApp message.
 *
 * @param {string} to      Member phone (any of the formats formatWhatsAppNumber handles)
 * @param {string} message Body text (truncated at Twilio's 1600-char limit)
 * @param {object} [opts]
 * @param {string} [opts.contentSid]        Approved template SID (for out-of-session sends)
 * @param {object} [opts.contentVariables]  Template variables, e.g. { 1: 'Ajeet' }
 * @param {string} [opts.mediaUrl]          Public image/PDF URL to attach
 * @param {number} [opts.retries=2]         Extra attempts on transient errors
 * @returns {Promise<{ok:boolean, channel:'whatsapp', skipped?:boolean, reason?:string,
 *                     sid?:string, to?:string, code?:number, error?:string}>}
 */
async function sendWhatsApp(to, message, opts = {}) {
  const { contentSid, contentVariables, mediaUrl, retries = 2 } = opts;

  if (!to) return { ok: false, channel: 'whatsapp', skipped: true, reason: 'no phone number on record' };
  if (!message && !contentSid) return { ok: false, channel: 'whatsapp', skipped: true, reason: 'empty message' };

  const status = whatsappStatus();
  if (!status.ok) {
    console.warn(`⚠️  WhatsApp skipped — ${status.reason}`);
    return { ok: false, channel: 'whatsapp', skipped: true, reason: status.reason };
  }

  const formattedTo = formatWhatsAppNumber(to);
  if (!formattedTo) {
    return { ok: false, channel: 'whatsapp', skipped: true, reason: `unparseable phone number "${to}"` };
  }

  const payload = { to: formattedTo };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    payload.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    payload.from = process.env.TWILIO_WHATSAPP_FROM;
  }
  if (contentSid) {
    payload.contentSid = contentSid;
    if (contentVariables) payload.contentVariables = JSON.stringify(contentVariables);
  } else {
    payload.body = message.length > WHATSAPP_BODY_LIMIT
      ? `${message.slice(0, WHATSAPP_BODY_LIMIT - 1)}…`
      : message;
  }
  if (mediaUrl) payload.mediaUrl = [mediaUrl];
  if (process.env.TWILIO_STATUS_CALLBACK) payload.statusCallback = process.env.TWILIO_STATUS_CALLBACK;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const msg = await getClient().messages.create(payload);
      console.log(`✅ WhatsApp sent to ${formattedTo} (${msg.sid})`);
      return { ok: true, channel: 'whatsapp', sid: msg.sid, to: formattedTo };
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isRetryable(err)) {
        const wait = 400 * 2 ** attempt; // 400ms, 800ms
        console.warn(`↻ WhatsApp retry ${attempt + 1}/${retries} for ${formattedTo} in ${wait}ms — [${err.code}] ${err.message}`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  // WhatsApp refuses free-form text outside the 24-hour customer-service window
  // (63015 / 63016). The only way through is an approved template, so if one is
  // configured, retry the same notification as that template. The template must
  // take the whole message as its single {{1}} variable.
  const templateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID;
  if (!contentSid && templateSid && (lastErr.code === 63015 || lastErr.code === 63016)) {
    try {
      const { body: _dropped, ...routing } = payload;   // a template replaces the body
      const msg = await getClient().messages.create({
        ...routing,
        contentSid: templateSid,
        contentVariables: JSON.stringify({ 1: message }),
      });
      console.log(`✅ WhatsApp sent to ${formattedTo} as template ${templateSid} (${msg.sid})`);
      return { ok: true, channel: 'whatsapp', sid: msg.sid, to: formattedTo, viaTemplate: true };
    } catch (err) {
      console.error(`❌ WhatsApp template fallback also failed for ${formattedTo}: [${err.code}] ${err.message}`);
      lastErr = err;
    }
  }

  const hint = explain(lastErr.code);
  console.error(`❌ WhatsApp failed for ${formattedTo}: [${lastErr.code}] ${lastErr.message}`);
  if (hint) console.error(`   ↳ ${hint}`);
  return {
    ok: false,
    channel: 'whatsapp',
    to: formattedTo,
    code: lastErr.code,
    error: lastErr.message,
    hint,
  };
}

/**
 * Fan a message out to many recipients with bounded concurrency.
 * @param {Array<{to:string, message:string, meta?:any}>} jobs
 * @param {number} concurrency
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

module.exports = {
  sendWhatsApp,
  sendBulkWhatsApp,
  formatWhatsAppNumber,
  isWhatsAppConfigured,
  whatsappStatus,
  verifyTwilio,
};
