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

const MIN_PASSWORD_LENGTH = 8;

// Change password (requires the current password)
router.post('/change-password', async (req, res) => {
  try {
    const { campaignSlug, email, password, newPassword } = req.body;

    if (!campaignSlug || !email || !password || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await firebase.updateCampaignPassword(campaignSlug, bcrypt.hashSync(newPassword, 10));

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Reset password when locked out — gated only by the campaign email, the one
// ownership factor this app has (intentionally weak; see "Forgot password?").
router.post('/reset-password', async (req, res) => {
  try {
    const { campaignSlug, email, newPassword } = req.body;

    if (!campaignSlug || !email || !newPassword) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email) {
      return res.status(401).json({ error: 'Email does not match this campaign' });
    }

    await firebase.updateCampaignPassword(campaignSlug, bcrypt.hashSync(newPassword, 10));

    res.json({ success: true, message: 'Password reset successfully' });
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
