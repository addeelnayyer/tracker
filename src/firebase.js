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

try {
  firebase = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.DB_URL,
    storageBucket: process.env.STORAGE_BUCKET
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

const db = admin.database();
const bucket = admin.storage().bucket();

// Utility functions for Firebase operations
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
    
    // Convert object to array
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

module.exports = {
  getDatabase,
  getBucket,
  getCampaign,
  setCampaign,
  getDonations,
  addDonation,
  updateCampaignAmount,
  deleteDonation,
  getDocuments,
  addDocument,
  updateDocumentOrders,
  deleteDocument,
  getBankDetails,
  addBankDetail,
  deleteBankDetail,
  uploadFile,
  deleteFile
};
