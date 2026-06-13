'use strict';

// Set test flags before any module is loaded
process.env.NASR_TEST = '1';
process.env.COOKIE_SECRET = 'test-secret-do-not-use-in-production';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// app is loaded after env vars are set; firebase.js returns {} in NASR_TEST mode
const app = require('../src/app');

// ─── In-memory fakes ──────────────────────────────────────────────────────────

function createFakeDb(seedCampaigns = {}) {
  const campaigns = new Map(Object.entries(seedCampaigns));
  const otpStates = new Map();
  const donations = new Map();    // campaignId → [{id, ...}]
  const bankDetails = new Map();  // campaignId → [{id, ...}]
  const documents = new Map();    // campaignId → [{id, ...}]
  let seq = 0;
  const nextId = (prefix) => `${prefix}-${++seq}`;

  return {
    async getCampaign(slug) {
      return campaigns.get(slug) ?? null;
    },
    async getOtpState(slug) {
      return otpStates.get(slug) ?? null;
    },
    async setOtpState(slug, state) {
      otpStates.set(slug, { ...state });
    },
    async clearOtpState(slug) {
      otpStates.delete(slug);
    },

    // ── Donations ──
    async addDonation(campaignId, data) {
      const id = nextId('don');
      if (!donations.has(campaignId)) donations.set(campaignId, []);
      donations.get(campaignId).push({ id, ...data });
      return id;
    },
    async getDonations(campaignId) {
      return donations.get(campaignId) ?? [];
    },
    async updateDonation(campaignId, donationId, data) {
      const list = donations.get(campaignId) ?? [];
      const idx = list.findIndex(d => d.id === donationId);
      if (idx !== -1) list[idx] = { ...list[idx], ...data };
    },
    async deleteDonation(campaignId, donationId) {
      const list = donations.get(campaignId) ?? [];
      donations.set(campaignId, list.filter(d => d.id !== donationId));
    },
    async updateCampaignAmount(slug, amount) {
      const c = campaigns.get(slug);
      if (c) c.accumulated_amount = amount;
    },

    // ── Bank details ──
    async addBankDetail(campaignId, data) {
      const id = nextId('bank');
      if (!bankDetails.has(campaignId)) bankDetails.set(campaignId, []);
      bankDetails.get(campaignId).push({ id, ...data });
      return id;
    },
    async getBankDetails(campaignId) {
      return bankDetails.get(campaignId) ?? [];
    },
    async deleteBankDetail(campaignId, bankDetailId) {
      const list = bankDetails.get(campaignId) ?? [];
      bankDetails.set(campaignId, list.filter(b => b.id !== bankDetailId));
    },

    // ── Documents ──
    async addDocument(campaignId, data) {
      const id = nextId('doc');
      if (!documents.has(campaignId)) documents.set(campaignId, []);
      documents.get(campaignId).push({ id, ...data });
      return id;
    },
    async getDocuments(campaignId) {
      return documents.get(campaignId) ?? [];
    },
    async deleteDocument(campaignId, documentId) {
      const list = documents.get(campaignId) ?? [];
      documents.set(campaignId, list.filter(d => d.id !== documentId));
    },
    async uploadFile(_file, _campaignId, _fileName) {
      return { url: 'http://fake/file', filePath: 'fake/path/file' };
    },
    async deleteFile(_filePath) {},
    async updateDocumentOrders(campaignId, order) {
      const list = documents.get(campaignId) ?? [];
      order.forEach((id, idx) => {
        const doc = list.find(d => d.id === id);
        if (doc) doc.display_order = idx;
      });
    },

    // ── Campaign ──
    async deleteCampaign(slug, _campaignId) {
      campaigns.delete(slug);
    },

    // test helper: read otp state directly
    _getOtpState(slug) {
      return otpStates.get(slug) ?? null;
    },
  };
}

function createFakeEmail() {
  const calls = [];
  return {
    async sendOtp(to, code) {
      calls.push({ to, code });
    },
    get lastCode() {
      return calls.length ? calls[calls.length - 1].code : null;
    },
    get callCount() {
      return calls.length;
    },
    reset() {
      calls.length = 0;
    },
  };
}

const { sign } = require('../src/cookieSession');

const CAMPAIGN_SLUG = 'test-campaign';
const ORGANIZER_EMAIL = 'organizer@example.com';
const CAMPAIGN = {
  id: 'campaign-id-1',
  email: ORGANIZER_EMAIL,
  slug: CAMPAIGN_SLUG,
  accumulated_amount: 0,
};

function makeSessionCookie(campaignId, slug) {
  const raw = sign({ campaignId, slug, exp: Date.now() + 60_000 });
  return `nasr_session=${raw}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OTP auth — tracer bullet', () => {
  let fakeDb;
  let fakeEmail;

  beforeEach(() => {
    fakeDb = createFakeDb({ [CAMPAIGN_SLUG]: { ...CAMPAIGN, accumulated_amount: 0 } });
    fakeEmail = createFakeEmail();
    app.locals.firebase = fakeDb;
    app.locals.email = fakeEmail;
  });

  test('OTP request with wrong email returns neutral 200 and sends no email', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: 'wrong@example.com' });

    assert.equal(res.status, 200);
    assert.ok(res.body.message, 'should have a message');
    assert.equal(fakeEmail.callCount, 0, 'should not send email for wrong address');
  });

  test('OTP request with correct email returns neutral 200 and sends 6-digit code', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    assert.equal(res.status, 200);
    assert.ok(res.body.message);
    assert.equal(fakeEmail.callCount, 1, 'should send one email');
    assert.match(fakeEmail.lastCode, /^\d{6}$/, 'code must be 6 digits');
  });

  test('OTP verify with wrong code returns 400 and does not set cookie', async () => {
    // Seed an OTP
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const res = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, code: '000000' });

    assert.equal(res.status, 400);
    const cookies = res.headers['set-cookie'] ?? [];
    assert.ok(!cookies.some(c => c.startsWith('nasr_session=')), 'should not set session cookie');
  });

  test('OTP verify with correct code sets a signed session cookie', async () => {
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const code = fakeEmail.lastCode;

    const res = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, code });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const cookies = res.headers['set-cookie'] ?? [];
    assert.ok(cookies.some(c => c.startsWith('nasr_session=')), 'should set nasr_session cookie');
  });

  test('authorized donation succeeds with valid session cookie', async () => {
    // Request + verify OTP to get a cookie
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, code: fakeEmail.lastCode });

    const sessionCookie = verifyRes.headers['set-cookie'].find(c => c.startsWith('nasr_session='));
    const cookieValue = sessionCookie.split(';')[0]; // strip flags

    const donRes = await request(app)
      .post(`/api/donations/${CAMPAIGN_SLUG}`)
      .set('Cookie', cookieValue)
      .send({ donorName: 'Alice', amount: '50', timestamp: new Date().toISOString() });

    assert.equal(donRes.status, 200);
    assert.equal(donRes.body.success, true);
    assert.ok(donRes.body.donationId);
  });

  test('donation with no session cookie returns 401', async () => {
    const res = await request(app)
      .post(`/api/donations/${CAMPAIGN_SLUG}`)
      .send({ donorName: 'Alice', amount: '50', timestamp: new Date().toISOString() });

    assert.equal(res.status, 401);
  });

  test('donation with wrong-campaign cookie returns 401', async () => {
    // Build a valid cookie for a different campaign
    const { sign } = require('../src/cookieSession');
    const wrongCookie = sign({
      campaignId: 'different-id',
      slug: 'different-slug',
      exp: Date.now() + 60_000,
    });

    const res = await request(app)
      .post(`/api/donations/${CAMPAIGN_SLUG}`)
      .set('Cookie', `nasr_session=${wrongCookie}`)
      .send({ donorName: 'Alice', amount: '50', timestamp: new Date().toISOString() });

    assert.equal(res.status, 401);
  });

  test('5 wrong verify attempts void the code', async () => {
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    // 4 wrong attempts — should return 400 with "Invalid code"
    for (let i = 0; i < 4; i++) {
      const r = await request(app)
        .post('/api/auth/otp/verify')
        .send({ campaignSlug: CAMPAIGN_SLUG, code: '000000' });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'Invalid code');
    }

    // 5th attempt — code is voided
    const finalAttempt = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, code: '000000' });
    assert.equal(finalAttempt.status, 400);
    assert.match(finalAttempt.body.error, /Too many failed attempts/);

    // Correct code no longer works after voiding
    const correctCode = fakeEmail.lastCode;
    const afterVoid = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, code: correctCode });
    assert.equal(afterVoid.status, 400);
  });

  test('resend cooldown: second request within 60s returns 429', async () => {
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const r2 = await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    assert.equal(r2.status, 429);
    assert.ok(r2.body.message);
    assert.equal(fakeEmail.callCount, 1, 'should not send second email');
  });
});

describe('Session-gated mutation routes', () => {
  let fakeDb;

  beforeEach(() => {
    fakeDb = createFakeDb({ [CAMPAIGN_SLUG]: { ...CAMPAIGN, accumulated_amount: 100 } });
    app.locals.firebase = fakeDb;
    app.locals.email = createFakeEmail();
  });

  // ── Donations: edit ──────────────────────────────────────────────────────────

  test('edit donation — authorized session returns 200', async () => {
    const donId = await fakeDb.addDonation(CAMPAIGN.id, {
      donor_name: 'Alice', amount: 50, timestamp: new Date().toISOString(),
    });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .put(`/api/donations/${CAMPAIGN_SLUG}/${donId}`)
      .set('Cookie', cookie)
      .send({ donorName: 'Alice Updated', amount: '60', timestamp: new Date().toISOString() });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('edit donation — no session cookie returns 401', async () => {
    const res = await request(app)
      .put(`/api/donations/${CAMPAIGN_SLUG}/don-123`)
      .send({ donorName: 'Alice', amount: '60', timestamp: new Date().toISOString() });

    assert.equal(res.status, 401);
  });

  // ── Donations: delete ────────────────────────────────────────────────────────

  test('delete donation — authorized session returns 200', async () => {
    const donId = await fakeDb.addDonation(CAMPAIGN.id, {
      donor_name: 'Bob', amount: 30, timestamp: new Date().toISOString(),
    });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .delete(`/api/donations/${CAMPAIGN_SLUG}/${donId}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('delete donation — no session cookie returns 401', async () => {
    const res = await request(app)
      .delete(`/api/donations/${CAMPAIGN_SLUG}/don-123`);

    assert.equal(res.status, 401);
  });

  // ── Bank details: add ────────────────────────────────────────────────────────

  test('add bank detail — authorized session returns 200', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .post(`/api/bank-details/${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie)
      .send({ bankName: 'First Bank', accountTitle: 'Org Account', accountNumber: '123456789' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.bankDetailId);
  });

  test('add bank detail — no session cookie returns 401', async () => {
    const res = await request(app)
      .post(`/api/bank-details/${CAMPAIGN_SLUG}`)
      .send({ bankName: 'First Bank', accountTitle: 'Org Account', accountNumber: '123456789' });

    assert.equal(res.status, 401);
  });

  // ── Bank details: delete ─────────────────────────────────────────────────────

  test('delete bank detail — authorized session returns 200', async () => {
    const bdId = await fakeDb.addBankDetail(CAMPAIGN.id, {
      bank_name: 'Bank', account_title: 'Acc', account_number: '000', created_at: new Date().toISOString(),
    });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .delete(`/api/bank-details/${CAMPAIGN_SLUG}/${bdId}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('delete bank detail — no session cookie returns 401', async () => {
    const res = await request(app)
      .delete(`/api/bank-details/${CAMPAIGN_SLUG}/bd-123`);

    assert.equal(res.status, 401);
  });

  // ── Documents: upload ────────────────────────────────────────────────────────

  test('upload document — authorized session returns 200', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .post(`/api/documents/${CAMPAIGN_SLUG}/upload`)
      .set('Cookie', cookie)
      .attach('documents', Buffer.from('%PDF-1.4 fake'), { filename: 'test.pdf', contentType: 'application/pdf' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.documents));
  });

  test('upload document — no session cookie returns 401', async () => {
    const res = await request(app)
      .post(`/api/documents/${CAMPAIGN_SLUG}/upload`)
      .attach('documents', Buffer.from('%PDF-1.4 fake'), { filename: 'test.pdf', contentType: 'application/pdf' });

    assert.equal(res.status, 401);
  });

  // ── Documents: reorder ───────────────────────────────────────────────────────

  test('reorder documents — authorized session returns 200', async () => {
    const id1 = await fakeDb.addDocument(CAMPAIGN.id, { name: 'a.pdf', file_path: 'a', url: 'u1', mime_type: 'application/pdf', size: 1, uploaded_at: new Date().toISOString(), display_order: 0 });
    const id2 = await fakeDb.addDocument(CAMPAIGN.id, { name: 'b.pdf', file_path: 'b', url: 'u2', mime_type: 'application/pdf', size: 1, uploaded_at: new Date().toISOString(), display_order: 1 });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .put(`/api/documents/${CAMPAIGN_SLUG}/reorder`)
      .set('Cookie', cookie)
      .send({ order: [id2, id1] });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('reorder documents — no session cookie returns 401', async () => {
    const res = await request(app)
      .put(`/api/documents/${CAMPAIGN_SLUG}/reorder`)
      .send({ order: ['doc-1', 'doc-2'] });

    assert.equal(res.status, 401);
  });

  // ── Documents: delete ────────────────────────────────────────────────────────

  test('delete document — authorized session returns 200', async () => {
    const docId = await fakeDb.addDocument(CAMPAIGN.id, { name: 'a.pdf', file_path: 'fake/a.pdf', url: 'u', mime_type: 'application/pdf', size: 1, uploaded_at: new Date().toISOString(), display_order: 0 });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .delete(`/api/documents/${CAMPAIGN_SLUG}/${docId}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('delete document — no session cookie returns 401', async () => {
    const res = await request(app)
      .delete(`/api/documents/${CAMPAIGN_SLUG}/doc-123`);

    assert.equal(res.status, 401);
  });

  // ── Campaign: delete ─────────────────────────────────────────────────────────

  test('delete campaign — authorized session, empty campaign returns 200', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);

    const res = await request(app)
      .delete(`/api/campaigns/${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  test('delete campaign — no session cookie returns 401', async () => {
    const res = await request(app)
      .delete(`/api/campaigns/${CAMPAIGN_SLUG}`);

    assert.equal(res.status, 401);
  });
});
