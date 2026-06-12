const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const firebase = require('../firebase');

// Verify password
const verifyPassword = (password, hash) => {
  return bcrypt.compareSync(password, hash);
};

// Verify campaign credentials
router.post('/verify', async (req, res) => {
  try {
    const { campaignSlug, email, password } = req.body;

    if (!campaignSlug || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Set session
    req.session.campaignId = campaign.id;
    req.session.campaignSlug = campaignSlug;

    res.json({ success: true, message: 'Authenticated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

module.exports = router;
