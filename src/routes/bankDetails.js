'use strict';

const express = require('express');
const router = express.Router();
const cookieSession = require('../cookieSession');

const MAX_FIELD_LENGTH = 140;

// Add a bank detail (requires session cookie)
router.post('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { bankName, accountTitle, accountNumber } = req.body;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!bankName || !accountTitle || !accountNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if ([bankName, accountTitle, accountNumber].some(f => String(f).length > MAX_FIELD_LENGTH)) {
      return res.status(400).json({ error: `Fields must be at most ${MAX_FIELD_LENGTH} characters` });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const bankDetailData = {
      bank_name: String(bankName).trim(),
      account_title: String(accountTitle).trim(),
      account_number: String(accountNumber).trim(),
      created_at: new Date().toISOString()
    };

    const bankDetailId = await fb.addBankDetail(campaign.id, bankDetailData);
    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true, bankDetailId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a bank detail (requires session cookie)
router.delete('/:campaignSlug/:bankDetailId', async (req, res) => {
  try {
    const { campaignSlug, bankDetailId } = req.params;
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

    await fb.deleteBankDetail(campaign.id, bankDetailId);
    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
