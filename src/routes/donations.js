const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const firebase = require('../firebase');

const verifyPassword = (password, hash) => bcrypt.compareSync(password, hash);

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  }
});

// Add a donation (requires authentication)
router.post('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { donorName, amount, timestamp, email, password } = req.body;

    if (!donorName || !amount || !timestamp || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const campaign = await firebase.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const donationAmount = parseFloat(amount);
    const donationData = {
      donor_name: donorName,
      amount: donationAmount,
      timestamp: new Date(timestamp).toISOString(),
      created_at: new Date().toISOString()
    };

    const donationId = await firebase.addDonation(campaign.id, donationData);
    await firebase.incrementCampaignAmount(campaignSlug, donationAmount);

    res.json({ success: true, donationId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Edit a donation (requires authentication)
router.put('/:campaignSlug/:donationId', async (req, res) => {
  try {
    const { campaignSlug, donationId } = req.params;
    const { donorName, amount, timestamp, email, password } = req.body;

    if (!donorName || !amount || !timestamp || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const campaign = await firebase.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const donations = await firebase.getDonations(campaign.id);
    const existing = donations.find(d => d.id === donationId);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    const newAmount = parseFloat(amount);
    await firebase.updateDonation(campaign.id, donationId, {
      donor_name: donorName,
      amount: newAmount,
      timestamp: new Date(timestamp).toISOString()
    });

    // Apply only the difference so a concurrent donation write isn't clobbered.
    await firebase.incrementCampaignAmount(campaignSlug, newAmount - existing.amount);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Attach proof to a donation (requires authentication)
router.post('/:campaignSlug/:donationId/proof', proofUpload.single('proof'), async (req, res) => {
  try {
    const { campaignSlug, donationId } = req.params;
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const campaign = await firebase.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const donations = await firebase.getDonations(campaign.id);
    const existing = donations.find(d => d.id === donationId);
    if (!existing) return res.status(404).json({ error: 'Donation not found' });

    const fileName = `proof-${uuidv4()}-${req.file.originalname}`;
    const { url, filePath } = await firebase.uploadFile(req.file, campaign.id, fileName);

    await firebase.updateDonation(campaign.id, donationId, {
      proof_url: url,
      proof_file_path: filePath,
      proof_mime_type: req.file.mimetype
    });

    res.json({ success: true, proof_url: url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a donation (requires authentication)
router.delete('/:campaignSlug/:donationId', async (req, res) => {
  try {
    const { campaignSlug, donationId } = req.params;
    const { email, password } = req.body;

    const campaign = await firebase.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const donations = await firebase.getDonations(campaign.id);
    const donation = donations.find(d => d.id === donationId);
    if (!donation) return res.status(404).json({ error: 'Donation not found' });

    await firebase.deleteDonation(campaign.id, donationId);
    await firebase.incrementCampaignAmount(campaignSlug, -donation.amount);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
