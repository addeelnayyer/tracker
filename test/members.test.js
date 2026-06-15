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
  const otpStates = new Map();
  const members = new Map(); // campaignId → [{id, email, added_at}]
  let seq = 0;
  const nextId = (prefix) => `${prefix}-${++seq}`;

  return {
    async getCampaign(slug) { return campaigns.get(slug) ?? null; },
    async setCampaign(slug, data) { campaigns.set(slug, { ...data }); },
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
    async getOtpState(slug, emailHash) { return otpStates.get(`${slug}/${emailHash}`) ?? null; },
    async setOtpState(slug, emailHash, state) { otpStates.set(`${slug}/${emailHash}`, { ...state }); },
    async clearOtpState(slug, emailHash) { otpStates.delete(`${slug}/${emailHash}`); },
    async getDonations() { return []; },
    async addDonation() {},
    async deleteDonation() {},
    async updateDonation() {},
    async updateCampaignAmount() {},
    async getBankDetails() { return []; },
    async addBankDetail() {},
    async deleteBankDetail() {},
    async getDocuments() { return []; },
    async addDocument() {},
    async deleteDocument() {},
    async updateDocumentOrders() {},
    async uploadFile() { return { url: 'http://fake/file', filePath: 'fake/path' }; },
    async deleteFile() {},
    async getPendingSignup() { return null; },
    async setPendingSignup() {},
    async clearPendingSignup() {},

    // ── Members ──
    async getMembers(campaignId) {
      return members.get(campaignId) ?? [];
    },
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

    // test helpers
    _getMembers(campaignId) { return members.get(campaignId) ?? []; },
  };
}

function createFakeEmail() {
  return { async sendOtp() {} };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CAMPAIGN_SLUG = 'test-campaign';
const ORGANIZER_EMAIL = 'organizer@example.com';
const CAMPAIGN = { id: 'campaign-id-1', email: ORGANIZER_EMAIL, slug: CAMPAIGN_SLUG, accumulated_amount: 0 };

function makeSessionCookie(campaignId, slug, role = 'organizer', email = ORGANIZER_EMAIL) {
  const raw = sign({ campaignId, slug, role, email, exp: Date.now() + 60_000 });
  return `__session=${raw}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Member management endpoints', () => {
  let fakeDb;

  beforeEach(() => {
    fakeDb = createFakeDb({ [CAMPAIGN_SLUG]: { ...CAMPAIGN } });
    app.locals.firebase = fakeDb;
    app.locals.email = createFakeEmail();
  });

  // ── GET /api/campaigns/:slug/members ──────────────────────────────────────

  test('GET members — organizer with no members returns empty list', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .get(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.members, []);
  });

  test('GET members — organizer sees existing members with id and email', async () => {
    await fakeDb.addMember(CAMPAIGN.id, { email: 'alice@example.com', added_at: '2026-01-01T00:00:00.000Z' });
    await fakeDb.addMember(CAMPAIGN.id, { email: 'bob@example.com', added_at: '2026-01-02T00:00:00.000Z' });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .get(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.members.length, 2);
    assert.ok(res.body.members[0].id);
    assert.equal(res.body.members[0].email, 'alice@example.com');
  });

  test('GET members — no session returns 401', async () => {
    const res = await request(app).get(`/api/campaigns/${CAMPAIGN_SLUG}/members`);
    assert.equal(res.status, 401);
  });

  test('GET members — member session returns 401', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG, 'member', 'member@example.com');
    const res = await request(app)
      .get(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie);
    assert.equal(res.status, 401);
  });

  test('GET members — campaignId mismatch returns 401', async () => {
    const cookie = makeSessionCookie('wrong-campaign-id', CAMPAIGN_SLUG);
    const res = await request(app)
      .get(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie);
    assert.equal(res.status, 401);
  });

  // ── POST /api/campaigns/:slug/members ──────────────────────────────────────

  test('organizer can add a member — returns { success, memberId } and persists entry', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie)
      .send({ email: 'member@example.com' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.memberId, 'must return a memberId');

    const stored = fakeDb._getMembers(CAMPAIGN.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].email, 'member@example.com');
    assert.ok(stored[0].added_at, 'must record added_at');
  });

  test('add member — no session returns 401', async () => {
    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .send({ email: 'member@example.com' });
    assert.equal(res.status, 401);
  });

  test('add member — member session returns 401', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG, 'member', 'member@example.com');
    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie)
      .send({ email: 'another@example.com' });
    assert.equal(res.status, 401);
  });

  test('add member — session campaignId mismatch returns 401', async () => {
    const cookie = makeSessionCookie('wrong-campaign-id', CAMPAIGN_SLUG);
    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie)
      .send({ email: 'member@example.com' });
    assert.equal(res.status, 401);
  });

  test('add member — missing email returns 400', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .post(`/api/campaigns/${CAMPAIGN_SLUG}/members`)
      .set('Cookie', cookie)
      .send({});
    assert.equal(res.status, 400);
  });

  // ── DELETE /api/campaigns/:slug/members/:memberId ─────────────────────────

  test('organizer can remove a member — returns { success: true } and entry is gone', async () => {
    const memberId = await fakeDb.addMember(CAMPAIGN.id, { email: 'member@example.com', added_at: new Date().toISOString() });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .delete(`/api/campaigns/${CAMPAIGN_SLUG}/members/${memberId}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const stored = fakeDb._getMembers(CAMPAIGN.id);
    assert.equal(stored.length, 0);
  });

  test('remove member — no session returns 401', async () => {
    const res = await request(app)
      .delete(`/api/campaigns/${CAMPAIGN_SLUG}/members/mem-1`);
    assert.equal(res.status, 401);
  });

  test('remove member — member session returns 401', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG, 'member', 'member@example.com');
    const res = await request(app)
      .delete(`/api/campaigns/${CAMPAIGN_SLUG}/members/mem-1`)
      .set('Cookie', cookie);
    assert.equal(res.status, 401);
  });

  test('remove member — session campaignId mismatch returns 401', async () => {
    const cookie = makeSessionCookie('wrong-campaign-id', CAMPAIGN_SLUG);
    const res = await request(app)
      .delete(`/api/campaigns/${CAMPAIGN_SLUG}/members/mem-1`)
      .set('Cookie', cookie);
    assert.equal(res.status, 401);
  });
});
