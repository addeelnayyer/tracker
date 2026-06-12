const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Create a new campaign
router.post('/', async (req, res) => {
  try {
    const { name, slug, targetAmount, email, password } = req.body;

    if (!name || !slug || !targetAmount || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const id = uuidv4();
    const passwordHash = db.hashPassword(password);

    await db.run(
      `INSERT INTO campaigns (id, slug, name, target_amount, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, slug, name, parseFloat(targetAmount), email, passwordHash]
    );

    res.status(201).json({ success: true, campaignId: id, slug });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Get campaign details
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const campaign = await db.get(
      `SELECT id, name, target_amount, accumulated_amount, created_at FROM campaigns WHERE slug = ?`,
      [slug]
    );

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const donations = await db.all(
      `SELECT donor_name, amount, timestamp FROM donations WHERE campaign_id = ? ORDER BY timestamp DESC`,
      [campaign.id]
    );

    const progressPercentage = (campaign.accumulated_amount / campaign.target_amount) * 100;

    res.json({
      ...campaign,
      donations,
      progressPercentage: Math.min(progressPercentage, 100)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
