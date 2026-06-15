'use strict';

process.env.NASR_TEST = '1';
process.env.COOKIE_SECRET = 'test-secret-do-not-use-in-production';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const { sign } = require('../src/cookieSession');

// ─── In-memory fake DB ────────────────────────────────────────────────────────

function createFakeDb(seedCampaigns = {}) {
  const campaigns = new Map(Object.entries(seedCampaigns));
  const members = new Map();   // campaignId → [{id, email, added_at}]
  const bankDetails = new Map();
  const donations = new Map();
  let seq = 0;
  const nextId = (prefix) => `${prefix}-${++seq}`;

  return {
    async getCampaign(slug) { return campaigns.get(slug) ?? null; },
    async getMembers(campaignId) { return members.get(campaignId) ?? []; },
    async addMember(campaignId, data) {
      const id = nextId('mem');
      if (!members.has(campaignId)) members.set(campaignId, []);
      members.get(campaignId).push({ id, ...data });
      return id;
    },
    async removeMember(campaignId, memberId) {
      const list = members.get(campaignId) ?? [];
      members.set(campaignId, list.filter(m => m.id !== memberId));
    },

    // Bank details
    async getBankDetails(campaignId) { return bankDetails.get(campaignId) ?? []; },
    async addBankDetail(campaignId, data) {
      const id = nextId('bank');
      if (!bankDetails.has(campaignId)) bankDetails.set(campaignId, []);
      bankDetails.get(campaignId).push({ id, ...data });
      return id;
    },
    async deleteBankDetail(campaignId, bankDetailId) {
      const list = bankDetails.get(campaignId) ?? [];
      bankDetails.set(campaignId, list.filter(b => b.id !== bankDetailId));
    },

    // Donations
    async getDonations(campaignId) { return donations.get(campaignId) ?? []; },
    async addDonation(campaignId, data) {
      const id = nextId('don');
      if (!donations.has(campaignId)) donations.set(campaignId, []);
      donations.get(campaignId).push({ id, ...data });
      return id;
    },
    async updateDonation(campaignId, donationId, data) {
      const list = donations.get(campaignId) ?? [];
      const idx = list.findIndex(d => d.id === donationId);
      if (idx !== -1) list[idx] = { ...list[idx], ...data };
    },
    async deleteDonation() {},
    async updateCampaignAmount() {},

    // Documents (unused by these tests but needed by routes)
    async getDocuments() { return []; },
    async addDocument() {},
    async deleteDocument() {},
    async updateDocumentOrders() {},
    async uploadFile() { return { url: 'http://fake/proof.jpg', filePath: 'fake/proof.jpg' }; },
    async deleteFile() {},

    // Campaign writes (needed by PATCH/DELETE tests)
    async updateCampaign(slug, partial) {
      const c = campaigns.get(slug);
      if (c) {
        for (const [k, v] of Object.entries(partial)) {
          if (v === null) delete c[k];
          else c[k] = v;
        }
      }
    },
    async deleteCampaign(slug) { campaigns.delete(slug); },

    // Pending signups (unused but may be required by some routes)
    async getPendingSignup() { return null; },
    async setPendingSignup() {},
    async clearPendingSignup() {},
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SLUG = 'test-camp';
const CAMPAIGN_ID = 'cid-1';
const ORGANIZER_EMAIL = 'organizer@example.com';
const MEMBER_EMAIL = 'member@example.com';

const CAMPAIGN = {
  id: CAMPAIGN_ID,
  email: ORGANIZER_EMAIL,
  slug: SLUG,
  accumulated_amount: 0,
  target_amount: 5000,
};

function makeSessionCookie(campaignId, slug, role = 'organizer', email = ORGANIZER_EMAIL) {
  const raw = sign({ campaignId, slug, role, email, exp: Date.now() + 60_000 });
  return `__session=${raw}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Member write access', () => {
  let fakeDb;

  beforeEach(() => {
    fakeDb = createFakeDb({ [SLUG]: { ...CAMPAIGN } });
    app.locals.firebase = fakeDb;
    app.locals.email = { async sendOtp() {} };
  });

  // ── Bank details ───────────────────────────────────────────────────────────

  test('member session can add a bank detail', async () => {
    await fakeDb.addMember(CAMPAIGN_ID, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });
    const cookie = makeSessionCookie(CAMPAIGN_ID, SLUG, 'member', MEMBER_EMAIL);

    const res = await request(app)
      .post(`/api/bank-details/${SLUG}`)
      .set('Cookie', cookie)
      .send({ bankName: 'HBL', accountTitle: 'Fund', accountNumber: '1234567890' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('member session can delete a bank detail', async () => {
    await fakeDb.addMember(CAMPAIGN_ID, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });
    const bankId = await fakeDb.addBankDetail(CAMPAIGN_ID, {
      bank_name: 'HBL', account_title: 'Fund', account_number: '123', created_at: new Date().toISOString()
    });
    const cookie = makeSessionCookie(CAMPAIGN_ID, SLUG, 'member', MEMBER_EMAIL);

    const res = await request(app)
      .delete(`/api/bank-details/${SLUG}/${bankId}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  // ── Proof attachment ───────────────────────────────────────────────────────

  test('member session can attach payment proof to a donation', async () => {
    await fakeDb.addMember(CAMPAIGN_ID, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });
    const donId = await fakeDb.addDonation(CAMPAIGN_ID, {
      donor_name: 'Ali', amount: 100, timestamp: new Date().toISOString(), created_at: new Date().toISOString()
    });
    const cookie = makeSessionCookie(CAMPAIGN_ID, SLUG, 'member', MEMBER_EMAIL);

    const res = await request(app)
      .post(`/api/donations/${SLUG}/${donId}/proof`)
      .set('Cookie', cookie)
      .attach('proof', Buffer.from('fake-image-data'), { filename: 'proof.jpg', contentType: 'image/jpeg' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  // ── Organizer-only routes reject member sessions ───────────────────────────

  test('member session receives 401 on PATCH campaign settings', async () => {
    const cookie = makeSessionCookie(CAMPAIGN_ID, SLUG, 'member', MEMBER_EMAIL);

    const res = await request(app)
      .patch(`/api/campaigns/${SLUG}`)
      .set('Cookie', cookie)
      .send({ name: 'New Name' });

    assert.equal(res.status, 401);
  });

  test('member session receives 401 on DELETE campaign', async () => {
    const cookie = makeSessionCookie(CAMPAIGN_ID, SLUG, 'member', MEMBER_EMAIL);

    const res = await request(app)
      .delete(`/api/campaigns/${SLUG}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 401);
  });

  // ── Immediate revocation ───────────────────────────────────────────────────

  test('removed member write is rejected even with a still-valid session cookie', async () => {
    const memberId = await fakeDb.addMember(CAMPAIGN_ID, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });
    const cookie = makeSessionCookie(CAMPAIGN_ID, SLUG, 'member', MEMBER_EMAIL);

    // Organizer removes the member
    await fakeDb.removeMember(CAMPAIGN_ID, memberId);

    const res = await request(app)
      .post(`/api/bank-details/${SLUG}`)
      .set('Cookie', cookie)
      .send({ bankName: 'HBL', accountTitle: 'Fund', accountNumber: '1234567890' });

    assert.equal(res.status, 401);
  });
});
