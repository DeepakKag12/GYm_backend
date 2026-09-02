/**
 * Branded HTML email wrapper.
 *
 * Deliberately plain, table-free-where-possible, inline-styled HTML: Gmail and
 * Outlook strip <style> blocks, so every rule lives on the element. Keep it
 * boring — clever CSS is what breaks in mail clients.
 */

const BRAND = process.env.BRAND_NAME || 'FITNATION BY AJEET';
const BRAND_COLOR = process.env.BRAND_COLOR || '#e63946';
const SITE_URL = process.env.FRONTEND_URL || 'https://gym-web-ten-puce.vercel.app';

/** Escape user-supplied text before it goes into HTML. */
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain-text message → HTML paragraphs, preserving the author's line breaks. */
function toParagraphs(message) {
  return String(message || '')
    .split(/\n{2,}/)
    .map(block => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#333;">${esc(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * @param {object} p
 * @param {string} p.title    Heading shown in the coloured band
 * @param {string} p.message  Body text (plain text; newlines respected)
 * @param {string} [p.ctaText] / [p.ctaUrl]  Optional call-to-action button
 * @param {string} [p.footerNote]
 */
function renderEmail({ title, message, ctaText, ctaUrl, footerNote }) {
  const cta = ctaText && ctaUrl
    ? `<p style="margin:24px 0 0;">
         <a href="${esc(ctaUrl)}" style="background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:bold;font-size:15px;display:inline-block;">${esc(ctaText)}</a>
       </p>`
    : '';

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:24px 12px;">
      <div style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <div style="background:${BRAND_COLOR};padding:22px 28px;">
          <h1 style="margin:0;color:#ffffff;font-size:19px;letter-spacing:0.5px;">${esc(BRAND)}</h1>
        </div>
        <div style="padding:28px;">
          <h2 style="margin:0 0 16px;font-size:18px;color:#111;">${esc(title)}</h2>
          ${toParagraphs(message)}
          ${cta}
        </div>
        <div style="padding:18px 28px;background:#fafafa;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#888;line-height:1.5;">
            ${esc(footerNote || `You are receiving this because you are a member of ${BRAND}.`)}<br>
            <a href="${esc(SITE_URL)}" style="color:${BRAND_COLOR};text-decoration:none;">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a>
          </p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { renderEmail, BRAND, SITE_URL };
