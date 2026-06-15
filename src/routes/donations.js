'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cookieSession = require('../cookieSession');
const { createMultipart } = require('../multipart');

async function checkMemberRevocation(fb, session) {
  if (session.role !== 'member') return true;
  const members = await fb.getMembers(session.campaignId);
  return members.some(m => m.email.toLowerCase() === session.email.toLowerCase());
}

const proofUpload = createMultipart({
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  }
});

// Add a donation — gated on the session cookie established by OTP login
router.post('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { donorName, amount, timestamp } = req.body;
    if (!donorName || !amount || !timestamp) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const donationAmount = parseFloat(amount);
    const donationData = {
      donor_name: donorName,
      amount: donationAmount,
      timestamp: new Date(timestamp).toISOString(),
      created_at: new Date().toISOString(),
    };

    const donationId = await fb.addDonation(campaign.id, donationData);
    const newAccumulatedAmount = (campaign.accumulated_amount || 0) + donationAmount;
    await fb.updateCampaignAmount(campaignSlug, newAccumulatedAmount);

    // Rolling-renew the session
    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });

    res.json({ success: true, donationId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Edit a donation (requires session cookie)
router.put('/:campaignSlug/:donationId', async (req, res) => {
  try {
    const { campaignSlug, donationId } = req.params;
    const { donorName, amount, timestamp } = req.body;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!donorName || !amount || !timestamp) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const donations = await fb.getDonations(campaign.id);
    const existing = donations.find(d => d.id === donationId);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    const newAmount = parseFloat(amount);
    await fb.updateDonation(campaign.id, donationId, {
      donor_name: donorName,
      amount: newAmount,
      timestamp: new Date(timestamp).toISOString()
    });

    const newAccumulatedAmount = campaign.accumulated_amount - existing.amount + newAmount;
    await fb.updateCampaignAmount(campaignSlug, newAccumulatedAmount);

    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Attach proof to a donation (requires session cookie)
router.post('/:campaignSlug/:donationId/proof', proofUpload.single('proof'), async (req, res) => {
  try {
    const { campaignSlug, donationId } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!await checkMemberRevocation(fb, session)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const donations = await fb.getDonations(campaign.id);
    const existing = donations.find(d => d.id === donationId);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    const fileName = `proof-${uuidv4()}-${req.file.originalname}`;
    const { url, filePath } = await fb.uploadFile(req.file, campaign.id, fileName);

    await fb.updateDonation(campaign.id, donationId, {
      proof_url: url,
      proof_file_path: filePath,
      proof_mime_type: req.file.mimetype
    });

    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug, role: session.role, email: session.email });
    res.json({ success: true, proof_url: url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a donation (requires session cookie)
router.delete('/:campaignSlug/:donationId', async (req, res) => {
  try {
    const { campaignSlug, donationId } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const donations = await fb.getDonations(campaign.id);
    const donation = donations.find(d => d.id === donationId);
    if (!donation) return res.status(404).json({ error: 'Donation not found' });

    await fb.deleteDonation(campaign.id, donationId);
    const newAccumulatedAmount = campaign.accumulated_amount - donation.amount;
    await fb.updateCampaignAmount(campaignSlug, newAccumulatedAmount);

    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
