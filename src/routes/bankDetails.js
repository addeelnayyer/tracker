const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const firebase = require('../firebase');

// Verify password
const verifyPassword = (password, hash) => {
  return bcrypt.compareSync(password, hash);
};

const MAX_FIELD_LENGTH = 140;

// Add a bank detail (requires authentication)
router.post('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { bankName, accountTitle, accountNumber, email, password } = req.body;

    if (!bankName || !accountTitle || !accountNumber || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if ([bankName, accountTitle, accountNumber].some(f => String(f).length > MAX_FIELD_LENGTH)) {
      return res.status(400).json({ error: `Fields must be at most ${MAX_FIELD_LENGTH} characters` });
    }

    // Get campaign and verify credentials
    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const bankDetailData = {
      bank_name: String(bankName).trim(),
      account_title: String(accountTitle).trim(),
      account_number: String(accountNumber).trim(),
      created_at: new Date().toISOString()
    };

    const bankDetailId = await firebase.addBankDetail(campaign.id, bankDetailData);

    res.json({ success: true, bankDetailId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a bank detail (requires authentication)
router.delete('/:campaignSlug/:bankDetailId', async (req, res) => {
  try {
    const { campaignSlug, bankDetailId } = req.params;
    const { email, password } = req.body;

    // Get campaign and verify credentials
    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await firebase.deleteBankDetail(campaign.id, bankDetailId);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
