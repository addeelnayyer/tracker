const admin = require('firebase-admin');
require('dotenv').config();

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/" + process.env.FIREBASE_CLIENT_EMAIL
};

let firebase;

try {
  firebase = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

const db = admin.database();

// Utility functions for Firebase operations
const getDatabase = () => db;

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

module.exports = {
  getDatabase,
  getCampaign,
  setCampaign,
  getDonations,
  addDonation,
  updateCampaignAmount,
  deleteDonation
};
