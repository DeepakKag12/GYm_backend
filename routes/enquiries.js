const express = require('express');
const router = express.Router();
const Enquiry = require('../models/Enquiry');
const { protect, adminOnly } = require('../middleware/auth');
const cache = require('../utils/cache');
const { notifyAdmin } = require('../services/notify');
const { sendEmail } = require('../utils/email');
const { renderEmail, BRAND, SITE_URL } = require('../utils/emailTemplate');
const { canonicalPhone } = require('../utils/phone');
const { sendDbError } = require('../utils/dbError');

const ENQUIRIES_KEY = 'enquiries:all';

// POST /api/enquiries - public: anyone can submit
router.post('/', async (req, res) => {
  try {
    /**
     * Whitelisted, and validated before it reaches Mongoose.
     *
     * `Enquiry.create(req.body)` took whatever the visitor posted, so a crafted
     * request could set `status: 'converted'` or write `notes` — fields that
     * belong to the admin. A missing field also surfaced as a 500 carrying the
     * raw schema error ("Path `phone` is required"), which is neither useful to
     * the visitor nor something to expose on a public endpoint.
     */
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const message = String(req.body.message || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const interest = String(req.body.interest || 'general');

    const VALID_INTEREST = ['membership', 'personal-training', 'diet-plan', 'supplements', 'general'];

    if (!name)    return res.status(400).json({ message: 'Please tell us your name.', field: 'name' });
    if (!phone)   return res.status(400).json({ message: 'Please leave a phone number so we can reply.', field: 'phone' });
    if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
      return res.status(400).json({ message: 'Enter a 10-digit mobile number.', field: 'phone' });
    }
    if (!message) return res.status(400).json({ message: 'Tell us what you would like to know.', field: 'message' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'That email address does not look right.', field: 'email' });
    }

    const enquiry = await Enquiry.create({
      name,
      phone: canonicalPhone(phone),
      message: message.slice(0, 2000),
      email: email || undefined,
      interest: VALID_INTEREST.includes(interest) ? interest : 'general',
      // status / notes / reply tracking are the admin's, never the visitor's.
    });
    cache.del(ENQUIRIES_KEY);

    // Alert the gym on WhatsApp + email so a lead isn't missed until someone
    // happens to open the admin panel. Fire-and-forget: a Twilio/SMTP hiccup
    // must never fail the visitor's form submission.
    notifyAdmin({
      title: `New enquiry from ${enquiry.name}`,
      message: `Name: ${enquiry.name}\nPhone: ${enquiry.phone}\nEmail: ${enquiry.email || '—'}\nInterest: ${enquiry.interest}\n\n"${enquiry.message}"`,
      ctaText: 'Open admin panel',
      ctaUrl: `${process.env.FRONTEND_URL || 'https://gym-web-ten-puce.vercel.app'}/admin/enquiries`,
    }).catch(err => console.error('⚠️  Enquiry alert failed:', err.message));

    res.status(201).json({ message: 'Thanks — we will get back to you soon.', enquiry });
  } catch (err) {
    // Never hand a raw database error to an anonymous visitor.
    console.error('Enquiry submission failed:', err.message);
    res.status(500).json({ message: 'Could not submit your enquiry. Please try again.' });
  }
});

// GET /api/enquiries - admin only
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const enquiries = await cache.getOrSet(ENQUIRIES_KEY, 60, () =>
      Enquiry.find().sort({ createdAt: -1 }).lean()
    );
    res.json(enquiries);
  } catch (err) {
    sendDbError(res, err);
  }
});

// PUT /api/enquiries/:id - admin update status
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!enquiry) return res.status(404).json({ message: 'Enquiry not found' });
    cache.del(ENQUIRIES_KEY);
    res.json(enquiry);
  } catch (err) {
    sendDbError(res, err);
  }
});


/**
 * POST /api/enquiries/:id/reply — admin answers an enquiry.
 *
 * Email is sent here and now, server-side. WhatsApp is returned as a wa.me link
 * for the admin to send from their own number, because automated WhatsApp needs
 * a registered Business sender that this gym does not have yet.
 *
 * Both channels are driven by one action on purpose: the admin writes the reply
 * once, the enquirer gets the email whether or not the WhatsApp is actually
 * sent, and the enquiry is marked answered either way.
 */
router.post('/:id/reply', protect, adminOnly, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ message: 'Write a reply first.' });

    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) return res.status(404).json({ message: 'Enquiry not found' });

    const subject = `Re: your enquiry — ${BRAND}`;

    // Email is best-effort: an enquiry with no email address is common, and a
    // mail failure must not stop the enquiry being marked answered.
    let emailResult = { skipped: true, reason: 'no email address on the enquiry' };
    if (enquiry.email) {
      try {
        emailResult = await sendEmail({
          to: enquiry.email,
          subject,
          text: message,
          html: renderEmail({
            title: 'Thanks for getting in touch',
            message,
            ctaText: 'Visit our website',
            ctaUrl: process.env.FRONTEND_URL || SITE_URL,
          }),
        });
      } catch (err) {
        emailResult = { ok: false, error: err.message };
      }
    }

    const digits = canonicalPhone(enquiry.phone);
    const whatsappUrl = digits
      ? `https://wa.me/${digits.length === 10 ? '91' + digits : digits}?text=${encodeURIComponent(message)}`
      : null;

    enquiry.repliedAt = new Date();
    enquiry.replyCount = (enquiry.replyCount || 0) + 1;
    enquiry.lastReplyBy = req.user._id;
    if (whatsappUrl) enquiry.lastWhatsAppAt = new Date();
    // Answering an enquiry moves it on, unless it has already been resolved.
    if (enquiry.status === 'new') enquiry.status = 'contacted';
    await enquiry.save();

    cache.del(ENQUIRIES_KEY);
    cache.delPattern('analytics:');

    res.json({
      message: enquiry.email
        ? `Reply emailed to ${enquiry.name}.`
        : `${enquiry.name} left no email address — send the WhatsApp message.`,
      enquiry,
      whatsappUrl,
      emailSent: Boolean(emailResult?.ok),
      emailSkipped: Boolean(emailResult?.skipped),
    });
  } catch (err) { sendDbError(res, err, 'Could not send this reply.'); }
});

// DELETE /api/enquiries/:id
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await Enquiry.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Enquiry not found' });
    cache.del(ENQUIRIES_KEY);
    res.json({ message: 'Enquiry deleted' });
  } catch (err) {
    sendDbError(res, err);
  }
});

module.exports = router;
