const express = require('express');
const router = express.Router();
const multer = require('multer');
const bcrypt = require('bcryptjs');
const firebase = require('../firebase');
const { v4: uuidv4 } = require('uuid');

// Configure multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit per file
  },
  fileFilter: (req, file, cb) => {
    // Organizer uploads are restricted to images and PDFs
    const allowedMimes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and PDFs are allowed.'));
    }
  }
});

// Verify password
const verifyPassword = (password, hash) => {
  return bcrypt.compareSync(password, hash);
};

// Upload documents
router.post('/:campaignSlug/upload', upload.array('documents', 10), async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Get campaign and verify credentials
    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const uploadedDocs = [];

    // New uploads append after everything already in the gallery: reordered
    // docs hold small sequential indices, so an epoch-ms order always lands last
    const orderBase = Date.now();

    // Upload each file
    for (const [index, file] of req.files.entries()) {
      const fileName = `${uuidv4()}-${file.originalname}`;
      const { url, filePath } = await firebase.uploadFile(file, campaign.id, fileName);

      // Save document metadata to database
      const docData = {
        name: file.originalname,
        file_path: filePath,
        url,
        mime_type: file.mimetype,
        size: file.size,
        uploaded_at: new Date().toISOString(),
        display_order: orderBase + index
      };

      const docId = await firebase.addDocument(campaign.id, docData);
      uploadedDocs.push({ id: docId, ...docData });
    }

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

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

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

// Reorder documents (requires authentication)
router.put('/:campaignSlug/reorder', async (req, res) => {
  try {
    const { campaignSlug } = req.params;
    const { email, password, order } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!Array.isArray(order) || order.length === 0 || !order.every(id => typeof id === 'string')) {
      return res.status(400).json({ error: 'Order must be a non-empty array of document IDs' });
    }

    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const documents = await firebase.getDocuments(campaign.id);
    const existingIds = new Set(documents.map(d => d.id));
    const uniqueOrder = new Set(order);

    if (uniqueOrder.size !== order.length ||
        order.length !== existingIds.size ||
        !order.every(id => existingIds.has(id))) {
      return res.status(409).json({ error: 'Order list does not match the campaign documents' });
    }

    await firebase.updateDocumentOrders(campaign.id, order);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Delete document (requires authentication)
router.delete('/:campaignSlug/:documentId', async (req, res) => {
  try {
    const { campaignSlug, documentId } = req.params;
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get campaign and verify credentials
    const campaign = await firebase.getCampaign(campaignSlug);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.email !== email || !verifyPassword(password, campaign.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get document
    const documents = await firebase.getDocuments(campaign.id);
    const document = documents.find(d => d.id === documentId);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from storage
    await firebase.deleteFile(document.file_path);

    // Delete from database
    await firebase.deleteDocument(campaign.id, documentId);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
