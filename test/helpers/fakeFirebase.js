// In-memory stand-in for src/firebase used by the HTTP tests. It models just
// enough of the Realtime Database surface to exercise the Express routes with
// no live RTDB, and — importantly — models the atomicity difference between the
// old read-modify-write total update and the new server-side increment:
//
//   - updateCampaignAmount(slug, newAmount) overwrites the stored total with a
//     value the caller computed from a (possibly stale) snapshot — lossy under
//     concurrency.
//   - incrementCampaignAmount(slug, delta) applies delta to whatever value is
//     CURRENT in the store, with no await between the read and the write, so
//     concurrent increments serialize the way ServerValue.increment does on the
//     server and never lose an update.
//
// Every async method yields once (`tick`) before touching state so that
// concurrent requests genuinely interleave at their await points in tests.

let campaigns = {}; // slug -> campaign object (includes accumulated_amount, id)
let donations = {}; // campaignId -> { donationId -> donationData }
let paymentRefs = {}; // providerRef (tracker) -> { campaignId, campaignSlug, donationId }
let donationSeq = 0;

const tick = () => new Promise((resolve) => setImmediate(resolve));

const reset = () => {
  campaigns = {};
  donations = {};
  paymentRefs = {};
  donationSeq = 0;
};

const seedCampaign = (campaign) => {
  campaigns[campaign.slug] = { accumulated_amount: 0, ...campaign };
  return campaigns[campaign.slug];
};

const getCampaign = async (slug) => {
  await tick();
  const campaign = campaigns[slug];
  // Return a shallow copy so callers see snapshot semantics, like a real read.
  return campaign ? { ...campaign } : null;
};

const addDonation = async (campaignId, donationData) => {
  await tick();
  const id = `d${++donationSeq}`;
  donations[campaignId] = donations[campaignId] || {};
  donations[campaignId][id] = { ...donationData };
  return id;
};

const getDonations = async (campaignId) => {
  await tick();
  const map = donations[campaignId] || {};
  return Object.keys(map).map((id) => ({ id, ...map[id] }));
};

const updateDonation = async (campaignId, donationId, data) => {
  await tick();
  const map = donations[campaignId] || {};
  if (map[donationId]) Object.assign(map[donationId], data);
};

const deleteDonation = async (campaignId, donationId) => {
  await tick();
  const map = donations[campaignId] || {};
  delete map[donationId];
};

// Lossy overwrite — kept so the old behaviour is still expressible and so other
// callers of the firebase surface keep working.
const updateCampaignAmount = async (slug, newAmount) => {
  await tick();
  if (campaigns[slug]) campaigns[slug].accumulated_amount = newAmount;
};

// Atomic: read-and-write of the live value with no intervening await.
const incrementCampaignAmount = async (slug, delta) => {
  await tick();
  if (campaigns[slug]) {
    campaigns[slug].accumulated_amount =
      (campaigns[slug].accumulated_amount || 0) + delta;
  }
};

// Tracker -> donation location index, so the single global webhook can find a
// pending donation by the Safepay tracker id alone (it doesn't know the campaign).
const setPaymentRef = async (providerRef, ref) => {
  await tick();
  paymentRefs[providerRef] = { ...ref };
};

const getPaymentRef = async (providerRef) => {
  await tick();
  const ref = paymentRefs[providerRef];
  return ref ? { ...ref } : null;
};

// Idempotent pending->confirmed flip + one-time increment. Mirrors the real
// RTDB transaction: a single `tick` then a synchronous read-check-write so two
// concurrent confirms for the same donation serialize — the first flips and
// increments, the second observes `confirmed` and is a no-op. Returns
// { confirmed } (true only for the delivery that performed the flip).
const confirmCardDonation = async (campaignSlug, campaignId, donationId, confirmedAt) => {
  await tick();
  const map = donations[campaignId] || {};
  const donation = map[donationId];
  if (!donation || donation.payment_status !== 'pending') return { confirmed: false };
  donation.payment_status = 'confirmed';
  donation.timestamp = confirmedAt;
  donation.confirmed_at = confirmedAt;
  if (campaigns[campaignSlug]) {
    campaigns[campaignSlug].accumulated_amount =
      (campaigns[campaignSlug].accumulated_amount || 0) + donation.amount;
  }
  return { confirmed: true };
};

// Read the authoritative stored total (test assertions; not part of the real API).
const getStoredAmount = (slug) =>
  campaigns[slug] ? campaigns[slug].accumulated_amount : undefined;

// Stubs for the rest of the firebase export surface so requiring the other
// routes never throws. None are exercised by the donation tests.
const noopAsync = async () => undefined;
const uploadFile = async () => ({ url: 'https://example.test/file', filePath: 'path/file' });

module.exports = {
  // test helpers
  reset,
  seedCampaign,
  getStoredAmount,
  // firebase surface used by the donation routes
  getCampaign,
  addDonation,
  getDonations,
  updateDonation,
  deleteDonation,
  updateCampaignAmount,
  incrementCampaignAmount,
  setPaymentRef,
  getPaymentRef,
  confirmCardDonation,
  uploadFile,
  // unused-by-tests stubs (kept to match the real module's surface)
  getDatabase: () => ({}),
  getBucket: () => ({}),
  setCampaign: noopAsync,
  updateCampaignPassword: noopAsync,
  getDocuments: async () => [],
  addDocument: noopAsync,
  updateDocumentOrders: noopAsync,
  deleteDocument: noopAsync,
  getBankDetails: async () => [],
  addBankDetail: noopAsync,
  deleteBankDetail: noopAsync,
  deleteCampaign: noopAsync,
  deleteFile: noopAsync,
};
