const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Add a donation (requires authentication)
router.post('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { donorName, amount, timestamp, email, password } = req.body;

    if (!donorName || !amount || !timestamp || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get campaign and verify credentials
    const campaign = await db.get(
      `SELECT id, password_hash FROM campaigns WHERE slug = ?`,
      [campaignSlug]
    );

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !db.verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Add donation
    const donationId = uuidv4();
    const donationAmount = parseFloat(amount);
    const donationTimestamp = new Date(timestamp).toISOString();

    await db.run(
      `INSERT INTO donations (id, campaign_id, donor_name, amount, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [donationId, campaign.id, donorName, donationAmount, donationTimestamp]
    );

    // Update campaign accumulated amount
    await db.run(
      `UPDATE campaigns SET accumulated_amount = accumulated_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [donationAmount, campaign.id]
    );

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
    const campaign = await db.get(
      `SELECT id, password_hash, email FROM campaigns WHERE slug = ?`,
      [campaignSlug]
    );

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !db.verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get donation amount before deleting
    const donation = await db.get(
      `SELECT amount FROM donations WHERE id = ? AND campaign_id = ?`,
      [donationId, campaign.id]
    );

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    // Delete donation
    await db.run(
      `DELETE FROM donations WHERE id = ? AND campaign_id = ?`,
      [donationId, campaign.id]
    );

    // Update campaign accumulated amount
    await db.run(
      `UPDATE campaigns SET accumulated_amount = accumulated_amount - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [donation.amount, campaign.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
