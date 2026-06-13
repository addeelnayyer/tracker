const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const firebase = require('../firebase');
const safepay = require('../safepay');

// Donor-facing card-donation bounds (PRD #1 / issue #5), enforced server-side
// in PKR before any conversion to Safepay's paisa unit.
const MIN_PKR = 1000;
const MAX_PKR = 1000000;

// Validate a donor-supplied amount server-side. Accepts a positive PKR value
// with at most two decimal places, within [MIN_PKR, MAX_PKR]. Returns
// { amount } on success or { error } on failure. Never trusts the client form.
function validateAmountPkr(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'Amount is required' };
  }
  // One regex rules out negatives, non-numerics (NaN), and >2 decimals at once.
  const str = String(raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return { error: 'Amount must be a positive number with at most two decimal places' };
  }
  const amount = Number(str);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'Amount must be greater than zero' };
  }
  if (amount < MIN_PKR) {
    return { error: `Minimum donation is PKR ${MIN_PKR.toLocaleString()}` };
  }
  if (amount > MAX_PKR) {
    return { error: `Maximum donation is PKR ${MAX_PKR.toLocaleString()}` };
  }
  return { amount };
}

// Public donor checkout: validate, create a pending card donation keyed by the
// Safepay tracker id, create the Safepay checkout session, and return the
// hosted-checkout redirect URL. No authentication — this is the first donation
// path open to the public. The pending record does not count toward any public
// total; only the signed webhook (#6) confirms it.
router.post('/:campaignSlug/checkout', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { amount, donorName, email } = req.body || {};

    const donorEmail = email ? String(email).trim() : '';
    if (!donorEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { amount: amountPkr, error } = validateAmountPkr(amount);
    if (error) return res.status(400).json({ error });

    const campaign = await firebase.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Success/cancel landing URLs are built from PUBLIC_BASE_URL, never guessed
    // from the request host (the webhook, not this redirect, is the source of
    // truth — issue #7 renders the pending-aware landing states).
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    // Safepay appends ?tracker=... to the success URL itself — don't pre-add
    // ?payment=success or the result is ?payment=success?tracker=... (two '?').
    // The client detects success from the presence of ?tracker= in the URL.
    const successUrl = `${base}/campaign/${campaignSlug}`;
    const cancelUrl = `${base}/campaign/${campaignSlug}?payment=cancelled`;

    const donorDisplayName = donorName ? String(donorName).trim() : '';

    const { tracker, redirectUrl } = await safepay.createCheckoutSession({
      amountPkr,
      successUrl,
      cancelUrl,
    });

    // Pending-first: the record is written before payment completes and carries
    // no `timestamp` — the card donation's timestamp is its confirmation time,
    // set by the webhook (#6). Gross accounting: stored amount is human PKR.
    const donationId = await firebase.addDonation(campaign.id, {
      donor_name: donorDisplayName || null,
      donor_email: donorEmail,
      amount: amountPkr,
      payment_method: 'card',
      payment_status: 'pending',
      provider: 'safepay',
      provider_ref: tracker,
      created_at: new Date().toISOString(),
    });

    // Index the tracker so the single global webhook can find this donation by
    // tracker id alone — it does not carry the campaign in its URL (#6).
    await firebase.setPaymentRef(tracker, {
      campaignId: campaign.id,
      campaignSlug,
      donationId,
    });

    res.json({ success: true, redirectUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Webhook — the money path (#6). The signed Safepay webhook is the SINGLE source
// of truth for confirming a card donation; the donor redirect is never trusted.
// ---------------------------------------------------------------------------

// Verify the HMAC-SHA512 (hex) signature over the EXACT raw request bytes, per
// ADR 0001. This lives in the route — not the stubbable safepay client — so the
// real verification runs even when safepay is mocked in tests, the same
// rationale as the checkout amount validation. Any shape problem => false; the
// compare is timing-safe.
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody || !rawBody.length) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(String(signature), 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

// A tracker may arrive as a bare string or nested under `.token`.
function pickTracker(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (c && typeof c === 'object' && typeof c.token === 'string' && c.token) return c.token;
  }
  return null;
}

const SUCCESS_RE = /(succeed|success|paid|captur|complete|ended)/i;
const FAILURE_RE = /(fail|declin|cancel|abandon|error|void|reject)/i;
function isPaymentSuccess(type, state) {
  const s = `${type} ${state}`;
  if (FAILURE_RE.test(s)) return false;
  return SUCCESS_RE.test(s);
}

// Pull the fields we key on out of a parsed Safepay webhook event. The exact
// envelope is confirmed against a live sandbox event (ADR 0001 "Open / to
// confirm"); the candidate paths are isolated here so a correction touches
// nothing else. Amount is paisa (ADR 0001 §1).
function parseWebhookEvent(body) {
  const env = body || {};
  const data = env.data || env.notification || {};
  const tracker = pickTracker(data.tracker, data.token, env.tracker);
  const amountRaw = data.amount != null ? data.amount : env.amount;
  const amountPaisa = amountRaw == null ? null : Number(amountRaw);
  const type = env.type || env.event || data.type || '';
  const state = data.state || data.status || env.state || '';
  return { tracker, amountPaisa, isSuccess: isPaymentSuccess(type, state) };
}

// Core confirmation, shared by the signed webhook and the sandbox simulate
// endpoint. Returns { status, body }. Always 200 for events we simply ignore
// (so Safepay stops retrying); 400 only on an amount that contradicts the
// pending record (possible tampering / wrong event).
async function confirmFromEvent(event) {
  const { tracker, amountPaisa, isSuccess } = parseWebhookEvent(event);
  if (!tracker) return { status: 200, body: { received: true, ignored: 'no_tracker' } };

  const ref = await firebase.getPaymentRef(tracker);
  if (!ref) return { status: 200, body: { received: true, ignored: 'unknown_tracker' } };

  const donations = await firebase.getDonations(ref.campaignId);
  const donation = donations.find((d) => d.id === ref.donationId);
  if (!donation) return { status: 200, body: { received: true, ignored: 'donation_missing' } };

  // Assert the webhook amount (paisa) equals the pending record converted to
  // paisa before confirming. Mismatch => refuse, change nothing.
  if (amountPaisa != null && amountPaisa !== safepay.toPaisa(donation.amount)) {
    return { status: 400, body: { error: 'Amount does not match the pending donation' } };
  }

  // Only an explicit success event confirms; created/failed/abandoned events are
  // acknowledged but leave the donation `pending` (invisible in public reads).
  if (!isSuccess) return { status: 200, body: { received: true, confirmed: false } };

  const result = await firebase.confirmCardDonation(
    ref.campaignSlug,
    ref.campaignId,
    ref.donationId,
    new Date().toISOString(),
  );
  return { status: 200, body: { received: true, confirmed: result.confirmed } };
}

// Public, signed webhook. One global endpoint (Safepay posts to one URL). The
// raw bytes are read from req.rawBody (the verify shim locally, the functions
// runtime on Cloud Functions — ADR 0001 §3).
router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.SAFEPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-sfpy-signature'];

    // TEMP diagnostic logging — dump everything the webhook receives so the
    // exact Safepay envelope, headers, and signature can be inspected against a
    // live event. Remove once the envelope (ADR 0001 "Open / to confirm") is
    // confirmed.
    const rawBody = req.rawBody;
    const rawStr = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : typeof rawBody === 'string'
        ? rawBody
        : null;
    console.log('[webhook] ───────────── incoming event ─────────────');
    console.log('[webhook] headers:', JSON.stringify(req.headers, null, 2));
    console.log('[webhook] x-sfpy-signature:', signature || '(none)');
    console.log('[webhook] secret configured:', Boolean(secret));
    console.log('[webhook] rawBody present:', rawBody != null, 'len:', rawStr ? rawStr.length : 0);
    console.log('[webhook] rawBody:', rawStr);
    console.log('[webhook] parsed body:', JSON.stringify(req.body, null, 2));
    console.log('[webhook] parsed event:', JSON.stringify(parseWebhookEvent(req.body || {})));

    if (!verifyWebhookSignature(req.rawBody, signature, secret)) {
      console.log('[webhook] signature verification: FAILED -> 401');
      return res.status(401).json({ error: 'Invalid or missing signature' });
    }
    console.log('[webhook] signature verification: OK');

    const { status, body } = await confirmFromEvent(req.body || {});
    console.log('[webhook] outcome:', status, JSON.stringify(body));
    res.status(status).json(body);
  } catch (err) {
    console.error('[webhook] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sandbox-only: simulate a successful payment webhook for a tracker so the money
// path can be exercised locally without a public tunnel. Hard-disabled in
// production — it bypasses the signature and must never be reachable there.
router.post('/simulate-webhook', async (req, res) => {
  try {
    if (process.env.SAFEPAY_ENV === 'production') {
      return res.status(404).json({ error: 'Not found' });
    }
    const { tracker } = req.body || {};
    if (!tracker) return res.status(400).json({ error: 'tracker is required' });

    const ref = await firebase.getPaymentRef(tracker);
    if (!ref) return res.status(404).json({ error: 'Unknown tracker' });
    const donations = await firebase.getDonations(ref.campaignId);
    const donation = donations.find((d) => d.id === ref.donationId);
    if (!donation) return res.status(404).json({ error: 'Donation not found' });

    // Build the canonical success event with the pending record's amount so the
    // shared confirm path (including the amount assertion) runs unchanged.
    const event = {
      type: 'payment.succeeded',
      data: { tracker, state: 'PAID', amount: safepay.toPaisa(donation.amount) },
    };
    const { status, body } = await confirmFromEvent(event);
    res.status(status).json({ ...body, simulated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
