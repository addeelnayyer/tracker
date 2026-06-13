// In test mode skip Firebase initialization entirely — app.locals.firebase is injected by tests
if (process.env.NASR_TEST === '1') {
  module.exports = {};
  return; // exits the CommonJS module wrapper
}

const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' }); // secrets for local dev
require('dotenv').config();                        // non-sensitive config

const serviceAccount = {
  type: "service_account",
  project_id: process.env.SA_PROJECT_ID,
  private_key_id: process.env.SA_PRIVATE_KEY_ID,
  private_key: process.env.SA_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.SA_CLIENT_EMAIL,
  client_id: process.env.SA_CLIENT_ID,
  auth_uri: process.env.SA_AUTH_URI,
  token_uri: process.env.SA_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.SA_CERT_URL,
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/" + process.env.SA_CLIENT_EMAIL
};

let firebase;
const hasServiceAccountKey = Boolean(process.env.SA_PRIVATE_KEY);

try {
  firebase = admin.initializeApp({
    // ADC fallback for deploy-time source analysis (SA secrets not yet injected)
    credential: hasServiceAccountKey
      ? admin.credential.cert(serviceAccount)
      : admin.credential.applicationDefault(),
    databaseURL: process.env.DB_URL,
    storageBucket: process.env.STORAGE_BUCKET
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  // No process.exit(1) — it kills deploy-time source analysis and silently aborts the deploy
  console.error('Firebase initialization error:', error);
}

const db = admin.database();
const bucket = admin.storage().bucket();


const getDatabase = () => db;
const getBucket = () => bucket;

const getCampaign = async (slug) => {
  try {
    const snapshot = await db.ref(`campaigns/${slug}`).once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error getting campaign:', error);
    throw error;
  }
};

// All campaigns, newest first. Used by the home register; callers are
// responsible for stripping sensitive fields (password_hash, email) before
// sending anything to the client.
const getAllCampaigns = async () => {
  try {
    const snapshot = await db.ref('campaigns').once('value');
    const campaigns = snapshot.val();
    if (!campaigns) return [];
    return Object.values(campaigns).sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  } catch (error) {
    console.error('Error getting campaigns:', error);
    throw error;
  }
};

const setCampaign = async (slug, campaignData) => {
  try {
    await db.ref(`campaigns/${slug}`).set(campaignData);
  } catch (error) {
    console.error('Error setting campaign:', error);
    throw error;
  }
};

const getDonations = async (campaignId) => {
  try {
    const snapshot = await db.ref(`donations/${campaignId}`).once('value');
    const donations = snapshot.val();
    if (!donations) return [];
    return Object.keys(donations).map(key => ({
      id: key,
      ...donations[key]
    }));
  } catch (error) {
    console.error('Error getting donations:', error);
    throw error;
  }
};

const addDonation = async (campaignId, donationData) => {
  try {
    const donationRef = db.ref(`donations/${campaignId}`).push();
    await donationRef.set(donationData);
    return donationRef.key;
  } catch (error) {
    console.error('Error adding donation:', error);
    throw error;
  }
};

const updateCampaignPassword = async (campaignSlug, passwordHash) => {
  try {
    await db.ref(`campaigns/${campaignSlug}/password_hash`).set(passwordHash);
  } catch (error) {
    console.error('Error updating campaign password:', error);
    throw error;
  }
};

const updateCampaignAmount = async (campaignSlug, newAmount) => {
  try {
    await db.ref(`campaigns/${campaignSlug}/accumulated_amount`).set(newAmount);
  } catch (error) {
    console.error('Error updating campaign amount:', error);
    throw error;
  }
};

const deleteDonation = async (campaignId, donationId) => {
  try {
    await db.ref(`donations/${campaignId}/${donationId}`).remove();
  } catch (error) {
    console.error('Error deleting donation:', error);
    throw error;
  }
};

const updateDonation = async (campaignId, donationId, data) => {
  try {
    await db.ref(`donations/${campaignId}/${donationId}`).update(data);
  } catch (error) {
    console.error('Error updating donation:', error);
    throw error;
  }
};

const getDocuments = async (campaignId) => {
  try {
    const snapshot = await db.ref(`documents/${campaignId}`).once('value');
    const documents = snapshot.val();
    if (!documents) return [];
    
    return Object.keys(documents).map(key => ({
      id: key,
      ...documents[key]
    }));
  } catch (error) {
    console.error('Error getting documents:', error);
    throw error;
  }
};

const addDocument = async (campaignId, documentData) => {
  try {
    const docRef = db.ref(`documents/${campaignId}`).push();
    await docRef.set(documentData);
    return docRef.key;
  } catch (error) {
    console.error('Error adding document:', error);
    throw error;
  }
};

const updateDocumentOrders = async (campaignId, orderedIds) => {
  try {
    const updates = {};
    orderedIds.forEach((docId, index) => {
      updates[`documents/${campaignId}/${docId}/display_order`] = index;
    });
    await db.ref().update(updates);
  } catch (error) {
    console.error('Error updating document order:', error);
    throw error;
  }
};

const deleteDocument = async (campaignId, documentId) => {
  try {
    await db.ref(`documents/${campaignId}/${documentId}`).remove();
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
};

const uploadFile = async (file, campaignId, fileName) => {
  try {
    const filePath = `campaigns/${campaignId}/${fileName}`;
    const fileRef = bucket.file(filePath);
    
    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        cacheControl: 'public, max-age=31536000'
      }
    });

    await fileRef.makePublic();
    const url = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

    return { url, filePath };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

const deleteFile = async (filePath) => {
  try {
    await bucket.file(filePath).delete();
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};

const getBankDetails = async (campaignId) => {
  const snapshot = await db.ref(`bank_details/${campaignId}`).once('value');
  const bankDetails = snapshot.val();
  if (!bankDetails) return [];
  return Object.keys(bankDetails).map(key => ({
    id: key,
    ...bankDetails[key]
  }));
};

const addBankDetail = async (campaignId, bankDetailData) => {
  const bankDetailRef = db.ref(`bank_details/${campaignId}`).push();
  await bankDetailRef.set(bankDetailData);
  return bankDetailRef.key;
};

const deleteBankDetail = async (campaignId, bankDetailId) => {
  await db.ref(`bank_details/${campaignId}/${bankDetailId}`).remove();
};

const getOtpState = async (slug) => {
  const snapshot = await db.ref(`otp_codes/${slug}`).once('value');
  return snapshot.val();
};

const setOtpState = async (slug, state) => {
  await db.ref(`otp_codes/${slug}`).set(state);
};

const clearOtpState = async (slug) => {
  await db.ref(`otp_codes/${slug}`).remove();
};

const getPendingSignup = async (token) => {
  const snapshot = await db.ref(`pending_signups/${token}`).once('value');
  return snapshot.val();
};

const setPendingSignup = async (token, data) => {
  await db.ref(`pending_signups/${token}`).set(data);
};

const clearPendingSignup = async (token) => {
  await db.ref(`pending_signups/${token}`).remove();
};

const deleteCampaign = async (slug, campaignId) => {
  await Promise.all([
    db.ref(`campaigns/${slug}`).remove(),
    db.ref(`donations/${campaignId}`).remove(),
    db.ref(`bank_details/${campaignId}`).remove(),
    db.ref(`documents/${campaignId}`).remove(),
  ]);
};

module.exports = {
  getDatabase,
  getBucket,
  getCampaign,
  getAllCampaigns,
  setCampaign,
  updateCampaignPassword,
  getDonations,
  addDonation,
  updateCampaignAmount,
  deleteDonation,
  updateDonation,
  getDocuments,
  addDocument,
  updateDocumentOrders,
  deleteDocument,
  getBankDetails,
  addBankDetail,
  deleteBankDetail,
  deleteCampaign,
  uploadFile,
  deleteFile,
  getOtpState,
  setOtpState,
  clearOtpState,
  getPendingSignup,
  setPendingSignup,
  clearPendingSignup,
};
