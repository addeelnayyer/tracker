const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const firebase = require('../firebase');

// Verify password
const verifyPassword = (password, hash) => {
  return bcrypt.compareSync(password, hash);
};

// Add a donation (requires authentication)
router.post('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { donorName, amount, timestamp, email, password } = req.body;

    if (!donorName || !amount || !timestamp || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get campaign and verify credentials
    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Add donation
    const donationAmount = parseFloat(amount);
    const donationTimestamp = new Date(timestamp).toISOString();

    const donationData = {
      donor_name: donorName,
      amount: donationAmount,
      timestamp: donationTimestamp,
      created_at: new Date().toISOString()
    };

    const donationId = await firebase.addDonation(campaign.id, donationData);

    // Update campaign accumulated amount
    const newAccumulatedAmount = campaign.accumulated_amount + donationAmount;
    await firebase.updateCampaignAmount(campaignSlug, newAccumulatedAmount);

    res.json({ success: true, donationId });
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

    // Get campaign and verify credentials
    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get donation to retrieve amount
    const donations = await firebase.getDonations(campaign.id);
    const donation = donations.find(d => d.id === donationId);

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    // Delete donation
    await firebase.deleteDonation(campaign.id, donationId);

    // Update campaign accumulated amount
    const newAccumulatedAmount = campaign.accumulated_amount - donation.amount;
    await firebase.updateCampaignAmount(campaignSlug, newAccumulatedAmount);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
