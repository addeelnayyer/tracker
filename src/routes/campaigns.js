const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const firebase = require('../firebase');

// Hash password utility
const hashPassword = (password) => {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
};

// Create a new campaign
router.post('/', async (req, res) => {
  try {
    const { name, slug, targetAmount, email, password } = req.body;

    if (!name || !slug || !targetAmount || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if campaign slug already exists
    const existingCampaign = await firebase.getCampaign(slug);
    if (existingCampaign) {
      return res.status(400).json({ error: 'Campaign slug already exists' });
    }

    const campaignId = uuidv4();
    const passwordHash = hashPassword(password);

    const campaignData = {
      id: campaignId,
      slug,
      name,
      target_amount: parseFloat(targetAmount),
      accumulated_amount: 0,
      email,
      password_hash: passwordHash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await firebase.setCampaign(slug, campaignData);

    res.status(201).json({ success: true, campaignId, slug });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Get campaign details (public read access)
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const campaign = await firebase.getCampaign(slug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const donations = await firebase.getDonations(campaign.id);

    const progressPercentage = (campaign.accumulated_amount / campaign.target_amount) * 100;

    // Return campaign data without sensitive information (password_hash, email)
    res.json({
      id: campaign.id,
      name: campaign.name,
      slug: campaign.slug,
      target_amount: campaign.target_amount,
      accumulated_amount: campaign.accumulated_amount,
      created_at: campaign.created_at,
      donations: donations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
      progressPercentage: Math.min(progressPercentage, 100)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
