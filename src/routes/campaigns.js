'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cookieSession = require('../cookieSession');

const OTP_TTL_MS = 10 * 60 * 1000;

const isLocalhost = (req) =>
  req.hostname === 'localhost' || req.hostname === '127.0.0.1';
const MAX_VERIFY_ATTEMPTS = 5;

function generateOtp() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

// Start campaign creation — store pending signup and email OTP
router.post('/', async (req, res) => {
  try {
    const { firebase, email } = req.app.locals;
    const { name, slug, targetAmount, currency, email: organizerEmail, zakatApplicable, testCampaign } = req.body;

    if (!name || !slug || !targetAmount || !organizerEmail) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const currencyCode = (currency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      return res.status(400).json({ error: 'Currency must be a 3-letter ISO code' });
    }

    if (slug.length < 3) {
      return res.status(400).json({ error: 'Slug must be at least 3 characters' });
    }

    const parsedTarget = parseFloat(targetAmount);
    if (!parsedTarget || parsedTarget <= 0) {
      return res.status(400).json({ error: 'Target amount must be greater than 0' });
    }

    const code = generateOtp();
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    await firebase.setPendingSignup(token, {
      name,
      slug,
      targetAmount: parsedTarget,
      currency: currencyCode,
      email: organizerEmail,
      zakatApplicable: Boolean(zakatApplicable),
      testCampaign: isLocalhost(req) && Boolean(testCampaign),
      codeHash: hashOtp(code),
      expiresAt: now + OTP_TTL_MS,
      attemptCount: 0,
    });

    await email.sendOtp(organizerEmail, code);

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm campaign creation — verify OTP, materialize campaign, log in
router.post('/confirm', async (req, res) => {
  try {
    const { firebase } = req.app.locals;
    const { token, code } = req.body;

    if (!token || code === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const pending = await firebase.getPendingSignup(token);

    if (!pending || Date.now() > pending.expiresAt) {
      return res.status(400).json({ error: 'Code expired or not found' });
    }

    const submitted = hashOtp(code);
    const stored = pending.codeHash;
    const match = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(stored));

    if (!match) {
      const attempts = (pending.attemptCount || 0) + 1;
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await firebase.clearPendingSignup(token);
        return res.status(400).json({ error: 'Too many failed attempts, please start over' });
      }
      await firebase.setPendingSignup(token, { ...pending, attemptCount: attempts });
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Check slug uniqueness at materialization time
    const existing = await firebase.getCampaign(pending.slug);
    if (existing) {
      await firebase.clearPendingSignup(token);
      return res.status(409).json({ error: 'Campaign slug already exists' });
    }

    const campaignId = uuidv4();
    const now = new Date().toISOString();
    const campaignData = {
      id: campaignId,
      slug: pending.slug,
      name: pending.name,
      target_amount: pending.targetAmount,
      currency: pending.currency,
      accumulated_amount: 0,
      zakat_applicable: Boolean(pending.zakatApplicable),
      test_campaign: Boolean(pending.testCampaign),
      email: pending.email,
      created_at: now,
      updated_at: now,
    };

    await firebase.setCampaign(pending.slug, campaignData);
    await firebase.clearPendingSignup(token);

    cookieSession.setSessionCookie(res, { campaignId, slug: pending.slug, role: 'organizer', email: pending.email });
    res.json({ success: true, slug: pending.slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Check if a slug is available — checks only materialized campaigns
router.get('/check-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const firebase = req.app.locals.firebase;
    const existing = await firebase.getCampaign(slug);
    res.json({ available: !existing });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Get campaign details (public read access)
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const firebase = req.app.locals.firebase;

    const campaign = await firebase.getCampaign(slug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const donations = await firebase.getDonations(campaign.id);
    const bankDetails = await firebase.getBankDetails(campaign.id);

    const sortedDonations = donations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const donationsLimit = parseInt(req.query?.donationsLimit, 10);
    const pagedDonations = donationsLimit > 0 ? sortedDonations.slice(0, donationsLimit) : sortedDonations;

    // A goal extension raises the effective target while the original goal
    // stays on record (and gets marked "achieved"). Progress tracks whichever
    // target is currently in play.
    const originalGoal = Number(campaign.target_amount) || 0;
    const extendedTargetRaw = Number(campaign.extended_target) || 0;
    const extendedTarget = extendedTargetRaw > originalGoal ? extendedTargetRaw : null;
    const effectiveGoal = extendedTarget || originalGoal;
    const progressPercentage = effectiveGoal > 0
      ? (campaign.accumulated_amount / effectiveGoal) * 100
      : 0;

    const lastDonationAt = donations.length > 0
      ? donations.reduce((latest, d) => {
          const at = d.created_at || d.timestamp || '';
          return at > latest ? at : latest;
        }, '')
      : null;

    res.json({
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      target_amount: campaign.target_amount,
      extended_target: extendedTarget,
      zakat_applicable: Boolean(campaign.zakat_applicable),
      test_campaign: Boolean(campaign.test_campaign),
      currency: campaign.currency || 'USD',
      accumulated_amount: campaign.accumulated_amount,
      created_at: campaign.created_at,
      last_donation_at: lastDonationAt,
      donations: pagedDonations,
      donations_count: sortedDonations.length,
      bank_details: bankDetails.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      progressPercentage: Math.min(progressPercentage, 100),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Update editable campaign fields — name, Zakat flag, goal extension.
// Session-gated like delete; only the campaign's own organizer may edit.
router.patch('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== slug || session.role !== 'organizer') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const campaign = await fb.getCampaign(slug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, zakatApplicable, testCampaign, extendedGoal, tourSeen } = req.body;
    const updates = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Campaign name cannot be empty' });
      if (trimmed.length > 140) return res.status(400).json({ error: 'Campaign name is too long (140 characters max)' });
      updates.name = trimmed;
    }

    if (zakatApplicable !== undefined) {
      updates.zakat_applicable = Boolean(zakatApplicable);
    }

    if (testCampaign !== undefined && isLocalhost(req)) {
      updates.test_campaign = Boolean(testCampaign);
    }

    if (tourSeen === true && !campaign.tour_seen_at) {
      updates.tour_seen_at = new Date().toISOString();
    }

    if (extendedGoal !== undefined) {
      if (extendedGoal === null || extendedGoal === '') {
        updates.extended_target = null; // remove the extension
      } else {
        const parsed = parseFloat(extendedGoal);
        if (!parsed || parsed <= 0) {
          return res.status(400).json({ error: 'Extended goal must be greater than 0' });
        }
        if (parsed <= Number(campaign.target_amount)) {
          return res.status(400).json({ error: 'Extended goal must be higher than the original goal' });
        }
        updates.extended_target = parsed;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    updates.updated_at = new Date().toISOString();
    await fb.updateCampaign(slug, updates);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== slug || session.role !== 'organizer') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const campaign = await fb.getCampaign(slug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const [donations, bankDetails, documents] = await Promise.all([
      fb.getDonations(campaign.id),
      fb.getBankDetails(campaign.id),
      fb.getDocuments(campaign.id),
    ]);

    if (donations.length > 0 || bankDetails.length > 0 || documents.length > 0) {
      return res.status(409).json({ error: 'Campaign is not empty — remove all donations, bank accounts, and documents first' });
    }

    await fb.deleteCampaign(slug, campaign.id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Member management (organizer-only) ──────────────────────────────────────

function requireOrganizer(session, campaign) {
  if (!session || session.role !== 'organizer') return false;
  if (campaign && campaign.id !== session.campaignId) return false;
  return true;
}

router.get('/:slug/members', async (req, res) => {
  try {
    const { slug } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    const campaign = await fb.getCampaign(slug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (!requireOrganizer(session, campaign) || !session || session.slug !== slug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const members = await fb.getMembers(campaign.id);
    res.json({ members });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:slug/members', async (req, res) => {
  try {
    const { slug } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== slug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const campaign = await fb.getCampaign(slug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (!requireOrganizer(session, campaign)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    const memberId = await fb.addMember(campaign.id, {
      email: email.trim(),
      added_at: new Date().toISOString(),
    });

    res.json({ success: true, memberId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:slug/members/:memberId', async (req, res) => {
  try {
    const { slug, memberId } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== slug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const campaign = await fb.getCampaign(slug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (!requireOrganizer(session, campaign)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await fb.removeMember(campaign.id, memberId);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
