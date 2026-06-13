'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const cookieSession = require('../cookieSession');
const firebase = require('../firebase');
const { createMultipart } = require('../multipart');

const upload = createMultipart({
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ];
    allowedMimes.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
  }
});

// Upload documents (requires session cookie)
router.post('/:campaignSlug/upload', upload.array('documents', 10), async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const uploadedDocs = [];
    const orderBase = Date.now();

    for (const [index, file] of req.files.entries()) {
      const fileName = `${uuidv4()}-${file.originalname}`;
      const { url, filePath } = await fb.uploadFile(file, campaign.id, fileName);

      const docData = {
        name: file.originalname,
        file_path: filePath,
        url,
        mime_type: file.mimetype,
        size: file.size,
        uploaded_at: new Date().toISOString(),
        display_order: orderBase + index
      };

      const docId = await fb.addDocument(campaign.id, docData);
      uploadedDocs.push({ id: docId, ...docData });
    }

    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true, documents: uploadedDocs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Get documents for a campaign (public read access)
router.get('/:campaignSlug', async (req, res) => {
  try {
    const { campaignSlug } = req.params;

    const campaign = await firebase.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const documents = await firebase.getDocuments(campaign.id);

    // Documents without display_order predate reordering; their upload time
    // slots them between reordered docs (small indices) and fresh uploads
    const displayOrder = (doc) =>
      typeof doc.display_order === 'number' ? doc.display_order : Date.parse(doc.uploaded_at) || 0;

    res.json({ documents: documents.sort((a, b) => displayOrder(a) - displayOrder(b)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Reorder documents (requires session cookie)
router.put('/:campaignSlug/reorder', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { order } = req.body;
    const fb = req.app.locals.firebase;

    const session = cookieSession.getSession(req);
    if (!session || session.slug !== campaignSlug) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(order) || order.length === 0 || !order.every(id => typeof id === 'string')) {
      return res.status(400).json({ error: 'Order must be a non-empty array of document IDs' });
    }

    const campaign = await fb.getCampaign(campaignSlug);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.id !== session.campaignId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const documents = await fb.getDocuments(campaign.id);
    const existingIds = new Set(documents.map(d => d.id));
    const uniqueOrder = new Set(order);

    if (uniqueOrder.size !== order.length ||
        order.length !== existingIds.size ||
        !order.every(id => existingIds.has(id))) {
      return res.status(409).json({ error: 'Order list does not match the campaign documents' });
    }

    await fb.updateDocumentOrders(campaign.id, order);
    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Delete document (requires session cookie)
router.delete('/:campaignSlug/:documentId', async (req, res) => {
  try {
    const { campaignSlug, documentId } = req.params;
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

    const documents = await fb.getDocuments(campaign.id);
    const document = documents.find(d => d.id === documentId);
    if (!document) return res.status(404).json({ error: 'Document not found' });

    await fb.deleteFile(document.file_path);
    await fb.deleteDocument(campaign.id, documentId);
    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
