const express = require('express');
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
    const successUrl = `${base}/campaign/${campaignSlug}?payment=success`;
    const cancelUrl = `${base}/campaign/${campaignSlug}?payment=cancelled`;

    const donorDisplayName = donorName ? String(donorName).trim() : '';

    const { tracker, redirectUrl } = await safepay.createCheckoutSession({
      amountPkr,
      donorEmail,
      donorName: donorDisplayName || null,
      successUrl,
      cancelUrl,
    });

    // Pending-first: the record is written before payment completes and carries
    // no `timestamp` — the card donation's timestamp is its confirmation time,
    // set by the webhook (#6). Gross accounting: stored amount is human PKR.
    await firebase.addDonation(campaign.id, {
      donor_name: donorDisplayName || null,
      donor_email: donorEmail,
      amount: amountPkr,
      payment_method: 'card',
      payment_status: 'pending',
      provider: 'safepay',
      provider_ref: tracker,
      created_at: new Date().toISOString(),
    });

    res.json({ success: true, redirectUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
