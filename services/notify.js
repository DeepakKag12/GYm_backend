/**
 * Unified notification dispatcher — one call, every channel.
 *
 * Before this, each caller hand-rolled its own delivery: create a Notification
 * doc, then `await sendWhatsApp(...)`, each with its own slightly different
 * message text, and email was never sent at all. Now every notification goes out
 * over **WhatsApp and email simultaneously** (Promise.allSettled, so the slower
 * leg never delays or cancels the other), with per-channel delivery status
 * written back onto the Notification document.
 *
 *   const { notifyMember } = require('../services/notify');
 *   await notifyMember(member, {
 *     type: 'fee-reminder',
 *     title: 'Your membership ends soon',
 *     message: 'Dear Ajeet, …',
 *     ctaText: 'Renew now', ctaUrl: 'https://…',
 *   });
 *
 * Design rules:
 *  - A delivery failure NEVER throws. The in-app notification is the source of
 *    truth; WhatsApp/email are best-effort and their outcome is recorded.
 *  - Channel config is checked once per send, not per member.
 *  - Bulk sends run with bounded concurrency so Twilio/SMTP aren't flooded.
 */
const Notification = require('../models/Notification');
const cache = require('../utils/cache');
const { sendWhatsApp, whatsappStatus } = require('../utils/whatsapp');
const { sendEmail, emailStatus } = require('../utils/email');
const { renderEmail, BRAND, SITE_URL } = require('../utils/emailTemplate');

const ALL_CHANNELS = ['website', 'whatsapp', 'email'];

/** The admin notification feed, invalidated whenever a notification is written. */
const ADMIN_FEED_KEY = 'notifs:admin:all';

/**
 * The gym's own WhatsApp number, under any of the names it has been given in
 * .env across the project's history.
 */
function adminWhatsAppNumber() {
  return process.env.ADMIN_WHATSAPP_NUMBER || process.env.ADMIN_WHATSAPP || process.env.GYM_WHATSAPP || '';
}

/** Cache key for a member's notification list — shared with routes/notifications.js. */
function notifKey(userId) {
  return `notifs:member:${userId}`;
}

/** WhatsApp body: brand header + optional title + message + link. */
function buildWhatsAppBody({ title, message, ctaText, ctaUrl }) {
  const parts = [`*${BRAND}*`];
  if (title) parts.push(`*${title}*`);
  parts.push(message);
  if (ctaUrl) parts.push(`${ctaText ? `${ctaText}: ` : ''}${ctaUrl}`);
  return parts.join('\n\n');
}

/** Which channels should actually be attempted for this member. */
function resolveChannels(member, requested) {
  const wanted = new Set(requested && requested.length ? requested : ALL_CHANNELS);
  // Per-member opt-outs (User.notifyWhatsApp / notifyEmail, default true)
  if (member && member.notifyWhatsApp === false) wanted.delete('whatsapp');
  if (member && member.notifyEmail === false) wanted.delete('email');
  return wanted;
}

/**
 * Send one notification to one member across all requested channels at once.
 *
 * @param {object} member  User document or lean object (needs _id, name, email, phone/whatsapp)
 * @param {object} payload
 * @param {string} payload.type      Notification type (see models/Notification.js enum)
 * @param {string} payload.title
 * @param {string} payload.message
 * @param {string} [payload.subject] Email subject (defaults to title)
 * @param {string} [payload.html]    Custom email HTML (defaults to branded template)
 * @param {string} [payload.ctaText] / [payload.ctaUrl]  Button in email, link in WhatsApp
 * @param {object} [opts]
 * @param {string[]} [opts.channels] Subset of ['website','whatsapp','email']
 * @param {boolean}  [opts.persist=true]  Write a Notification document
 * @returns {Promise<{notification:object|null, results:{whatsapp?:object, email?:object},
 *                    delivered:string[], failed:string[]}>}
 */
async function notifyMember(member, payload, opts = {}) {
  const { type = 'general', title, message, subject, html, ctaText, ctaUrl } = payload;
  const { persist = true } = opts;
  const channels = resolveChannels(member, opts.channels);

  // 1. In-app first — it must survive even if both external channels are down.
  let notification = null;
  if (persist && channels.has('website')) {
    notification = await Notification.create({
      member: member._id,
      type,
      title,
      message,
      sentVia: ['website'],
    });
    cache.del(notifKey(member._id));
    cache.del(ADMIN_FEED_KEY);
  }

  // 2. WhatsApp + email fire together; neither waits on the other.
  const tasks = [];
  if (channels.has('whatsapp')) {
    const to = member.whatsapp || member.phone;
    tasks.push(sendWhatsApp(to, buildWhatsAppBody({ title, message, ctaText, ctaUrl })));
  }
  if (channels.has('email')) {
    tasks.push(
      sendEmail(member.email, subject || title, {
        title,
        text: message,
        html: html || renderEmail({ title, message, ctaText, ctaUrl }),
        ctaText,
        ctaUrl,
      })
    );
  }

  const settled = await Promise.allSettled(tasks);
  const results = {};
  for (const s of settled) {
    // A rejected promise means a bug in the sender, not a delivery failure —
    // the senders are written to resolve with { ok:false } instead of throwing.
    const r = s.status === 'fulfilled'
      ? s.value
      : { ok: false, channel: 'unknown', error: s.reason && s.reason.message };
    results[r.channel] = r;
  }

  const delivered = Object.values(results).filter(r => r.ok).map(r => r.channel);
  const failed = Object.values(results).filter(r => !r.ok).map(r => r.channel);

  // 3. Record what actually went out, so the admin can see per-channel status.
  if (notification) {
    notification.sentVia = ['website', ...delivered];
    notification.delivery = {
      whatsapp: toDelivery(results.whatsapp),
      email: toDelivery(results.email),
    };
    await notification.save().catch(err =>
      console.error(`⚠️  Could not save delivery status for notification ${notification._id}: ${err.message}`)
    );
    cache.del(notifKey(member._id));
  }

  return { notification, results, delivered, failed };
}

/** Map a sender result onto the Notification.delivery sub-document. */
function toDelivery(r) {
  if (!r) return undefined;
  return {
    status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed',
    ref: r.sid || r.messageId,
    error: r.error || r.reason,
    at: new Date(),
  };
}

/**
 * Bulk version: same notification (or a per-member one) to many members, run with
 * bounded concurrency so a 500-member sweep doesn't hit Twilio's rate limit.
 *
 * @param {Array} members
 * @param {Function|object} payloadOrFn  payload, or (member) => payload | null (null = skip)
 * @param {object} [opts] channels, persist, concurrency (default 5)
 */
async function notifyMembers(members, payloadOrFn, opts = {}) {
  const { concurrency = 5 } = opts;
  const summary = { total: members.length, sent: 0, skipped: 0, whatsapp: 0, email: 0, failed: 0, errors: [] };

  let cursor = 0;
  const worker = async () => {
    while (cursor < members.length) {
      const member = members[cursor++];
      let payload;
      try {
        payload = typeof payloadOrFn === 'function' ? await payloadOrFn(member) : payloadOrFn;
      } catch (err) {
        summary.failed++;
        summary.errors.push({ member: String(member._id), error: err.message });
        continue;
      }
      if (!payload) { summary.skipped++; continue; }

      try {
        const { delivered } = await notifyMember(member, payload, opts);
        summary.sent++;
        if (delivered.includes('whatsapp')) summary.whatsapp++;
        if (delivered.includes('email')) summary.email++;
      } catch (err) {
        // One member's failure must never abort the sweep.
        summary.failed++;
        summary.errors.push({ member: String(member._id), error: err.message });
        console.error(`❌ Notify failed for ${member._id}: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, members.length) || 1 }, worker));
  return summary;
}

/**
 * Notify the gym owner/admin (no Notification document — this is an ops alert).
 * Uses ADMIN_WHATSAPP and ADMIN_EMAIL.
 */
async function notifyAdmin({ title, message, ctaText, ctaUrl }) {
  const to = adminWhatsAppNumber();
  const email = process.env.ADMIN_EMAIL || process.env.BREVO_FROM_EMAIL || process.env.EMAIL_USER;

  const settled = await Promise.allSettled([
    to ? sendWhatsApp(to, buildWhatsAppBody({ title, message, ctaText, ctaUrl }))
       : Promise.resolve({ ok: false, channel: 'whatsapp', skipped: true, reason: 'ADMIN_WHATSAPP_NUMBER not set' }),
    email ? sendEmail(email, title, { title, text: message, ctaText, ctaUrl })
          : Promise.resolve({ ok: false, channel: 'email', skipped: true, reason: 'ADMIN_EMAIL not set' }),
  ]);

  const results = {};
  for (const s of settled) {
    const r = s.status === 'fulfilled' ? s.value : { ok: false, channel: 'unknown', error: s.reason && s.reason.message };
    results[r.channel] = r;
  }
  return results;
}

/** Config report for the admin health endpoint. */
function channelHealth() {
  const wa = whatsappStatus();
  const em = emailStatus();
  return {
    whatsapp: { configured: wa.ok, from: wa.from, auth: wa.auth, warning: wa.warning, reason: wa.reason },
    email: { configured: em.ok, from: em.from, transport: em.transport, via: em.via, reason: em.reason },
    website: { configured: true },
    brand: BRAND,
    siteUrl: SITE_URL,
  };
}

module.exports = {
  adminWhatsAppNumber,
  notifyMember,
  notifyMembers,
  notifyAdmin,
  channelHealth,
  buildWhatsAppBody,
  notifKey,
  ALL_CHANNELS,
};
