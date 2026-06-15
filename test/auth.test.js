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
  const donations = new Map();       // campaignId → [{id, ...}]
  const bankDetails = new Map();     // campaignId → [{id, ...}]
  const documents = new Map();       // campaignId → [{id, ...}]
  const pendingSignups = new Map();  // token → {name, slug, ...}
  const members = new Map();         // campaignId → [{id, email, ...}]
  let seq = 0;
  const nextId = (prefix) => `${prefix}-${++seq}`;

  return {
    async getCampaign(slug) {
      return campaigns.get(slug) ?? null;
    },
    async setCampaign(slug, data) {
      campaigns.set(slug, { ...data });
    },
    async getOtpState(slug, emailHash) {
      return otpStates.get(`${slug}/${emailHash}`) ?? null;
    },
    async setOtpState(slug, emailHash, state) {
      otpStates.set(`${slug}/${emailHash}`, { ...state });
    },
    async clearOtpState(slug, emailHash) {
      otpStates.delete(`${slug}/${emailHash}`);
    },

    // ── Pending signups ──
    async getPendingSignup(token) {
      return pendingSignups.get(token) ?? null;
    },
    async setPendingSignup(token, data) {
      pendingSignups.set(token, { ...data });
    },
    async clearPendingSignup(token) {
      pendingSignups.delete(token);
    },
    _getPendingSignup(token) {
      return pendingSignups.get(token) ?? null;
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
    async updateCampaign(slug, partial) {
      const c = campaigns.get(slug);
      if (c) {
        // null values remove the key; non-null values merge
        for (const [k, v] of Object.entries(partial)) {
          if (v === null) delete c[k];
          else c[k] = v;
        }
      }
    },
    async deleteCampaign(slug, _campaignId) {
      campaigns.delete(slug);
    },

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

    // test helper: read otp state directly
    _getOtpState(slug, emailHash) {
      return otpStates.get(`${slug}/${emailHash}`) ?? null;
    },
    _getCampaign(slug) {
      return campaigns.get(slug) ?? null;
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

function makeSessionCookie(campaignId, slug, role = 'organizer', email = ORGANIZER_EMAIL) {
  const raw = sign({ campaignId, slug, role, email, exp: Date.now() + 60_000 });
  return `__session=${raw}`;
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
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: '000000' });

    assert.equal(res.status, 400);
    const cookies = res.headers['set-cookie'] ?? [];
    assert.ok(!cookies.some(c => c.startsWith('__session=')), 'should not set session cookie');
  });

  test('OTP verify with correct code sets a signed session cookie', async () => {
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const code = fakeEmail.lastCode;

    const res = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const cookies = res.headers['set-cookie'] ?? [];
    assert.ok(cookies.some(c => c.startsWith('__session=')), 'should set nasr_session cookie');
  });

  test('authorized donation succeeds with valid session cookie', async () => {
    // Request + verify OTP to get a cookie
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: fakeEmail.lastCode });

    const sessionCookie = verifyRes.headers['set-cookie'].find(c => c.startsWith('__session='));
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
      .set('Cookie', `__session=${wrongCookie}`)
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
        .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: '000000' });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, 'Invalid code');
    }

    // 5th attempt — code is voided
    const finalAttempt = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: '000000' });
    assert.equal(finalAttempt.status, 400);
    assert.match(finalAttempt.body.error, /Too many failed attempts/);

    // Correct code no longer works after voiding
    const correctCode = fakeEmail.lastCode;
    const afterVoid = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: correctCode });
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

describe('Session-status endpoint', () => {
  let fakeDb;

  beforeEach(() => {
    fakeDb = createFakeDb({ [CAMPAIGN_SLUG]: { ...CAMPAIGN } });
    app.locals.firebase = fakeDb;
    app.locals.email = createFakeEmail();
  });

  test('status without cookie returns { authenticated: false }', async () => {
    const res = await request(app).get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);
  });

  test('status with valid session cookie for matching slug returns { authenticated: true }', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
  });

  test('status with cookie for different slug returns { authenticated: false }', async () => {
    const cookie = makeSessionCookie('other-id', 'other-slug');
    const res = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);
  });

  test('status returns role: organizer for a session with role organizer', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG, 'organizer', ORGANIZER_EMAIL);
    const res = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.role, 'organizer');
  });

  test('OTP verify with correct code creates session with role: organizer (status returns role)', async () => {
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: app.locals.email.lastCode });

    assert.equal(verifyRes.status, 200);
    const sessionCookie = verifyRes.headers['set-cookie'].find(c => c.startsWith('__session='));
    assert.ok(sessionCookie, 'session cookie must be set');

    const cookieValue = sessionCookie.split(';')[0];
    const statusRes = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookieValue);

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.authenticated, true);
    assert.equal(statusRes.body.role, 'organizer');
  });
});

describe('Tour — auth/status tourPending + PATCH tourSeen', () => {
  let fakeDb;

  beforeEach(() => {
    fakeDb = createFakeDb({ [CAMPAIGN_SLUG]: { ...CAMPAIGN } });
    app.locals.firebase = fakeDb;
    app.locals.email = createFakeEmail();
  });

  test('status for authenticated organizer with no tour_seen_at returns tourPending: true', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.tourPending, true);
  });

  test('status for authenticated organizer with tour_seen_at set returns tourPending: false', async () => {
    await fakeDb.updateCampaign(CAMPAIGN_SLUG, { tour_seen_at: new Date().toISOString() });
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.tourPending, false);
  });

  test('status for unauthenticated visitor does not include tourPending', async () => {
    const res = await request(app).get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.tourPending, undefined);
  });

  test('PATCH tourSeen with valid session sets tour_seen_at and returns 200', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG);
    const res = await request(app)
      .patch(`/api/campaigns/${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie)
      .send({ tourSeen: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const updated = fakeDb._getCampaign(CAMPAIGN_SLUG);
    assert.ok(updated.tour_seen_at, 'tour_seen_at must be set');
  });

  test('PATCH tourSeen without session returns 401 and does not write', async () => {
    const res = await request(app)
      .patch(`/api/campaigns/${CAMPAIGN_SLUG}`)
      .send({ tourSeen: true });
    assert.equal(res.status, 401);
    const campaign = fakeDb._getCampaign(CAMPAIGN_SLUG);
    assert.equal(campaign.tour_seen_at, undefined, 'tour_seen_at must not be written');
  });
});

describe('Dead password endpoints removed', () => {
  // Seed a real campaign so legacy handlers would respond with 401, not 404.
  // After the endpoints are deleted, Express returns 404 for unknown routes.
  const SEED = { 'test-slug': { id: 'cmp-1', slug: 'test-slug', email: 'owner@test.com', password_hash: '$2a$10$placeholder' } };

  beforeEach(() => {
    app.locals.firebase = createFakeDb(SEED);
    app.locals.email = createFakeEmail();
  });

  test('POST /api/auth/verify returns 404', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .send({ campaignSlug: 'test-slug', email: 'owner@test.com', password: 'wrongpassword' });
    assert.equal(res.status, 404);
  });

  test('POST /api/auth/change-password returns 404', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ campaignSlug: 'test-slug', email: 'owner@test.com', password: 'old', newPassword: 'new12345' });
    assert.equal(res.status, 404);
  });

  test('POST /api/auth/reset-password returns 404', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ campaignSlug: 'test-slug', email: 'owner@test.com', newPassword: 'new12345' });
    assert.equal(res.status, 404);
  });
});

describe('OTP-verified campaign creation', () => {
  const NEW_SLUG = 'new-campaign';
  const CREATOR_EMAIL = 'creator@example.com';
  const CREATION_FIELDS = {
    name: 'New Campaign',
    slug: NEW_SLUG,
    targetAmount: 5000,
    currency: 'USD',
    email: CREATOR_EMAIL,
  };

  let fakeDb;
  let fakeEmail;

  beforeEach(() => {
    fakeDb = createFakeDb({});
    fakeEmail = createFakeEmail();
    app.locals.firebase = fakeDb;
    app.locals.email = fakeEmail;
  });

  test('POST /api/campaigns without password stores pending signup and emails a code', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send(CREATION_FIELDS);

    assert.equal(res.status, 200);
    assert.ok(res.body.token, 'should return a token');
    assert.equal(fakeEmail.callCount, 1, 'should send one email');
    assert.match(fakeEmail.lastCode, /^\d{6}$/, 'code must be 6 digits');
  });

  test('POST /api/campaigns does NOT create a campaign record', async () => {
    await request(app).post('/api/campaigns').send(CREATION_FIELDS);

    const campaign = await fakeDb.getCampaign(NEW_SLUG);
    assert.equal(campaign, null, 'campaign must not exist before confirmation');
  });

  test('POST /api/campaigns with a password field ignores it and succeeds', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send({ ...CREATION_FIELDS, password: 'ShouldBeIgnored1' });

    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  test('POST /api/campaigns without required fields returns 400', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send({ name: 'Incomplete' });

    assert.equal(res.status, 400);
  });

  test('confirm with correct code materializes campaign and sets session cookie', async () => {
    const startRes = await request(app)
      .post('/api/campaigns')
      .send(CREATION_FIELDS);

    const { token } = startRes.body;
    const code = fakeEmail.lastCode;

    const confirmRes = await request(app)
      .post('/api/campaigns/confirm')
      .send({ token, code });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.success, true);
    assert.equal(confirmRes.body.slug, NEW_SLUG);

    const cookies = confirmRes.headers['set-cookie'] ?? [];
    assert.ok(cookies.some(c => c.startsWith('__session=')), 'should set nasr_session cookie');

    const campaign = await fakeDb.getCampaign(NEW_SLUG);
    assert.ok(campaign, 'campaign should exist after confirmation');
    assert.equal(campaign.name, 'New Campaign');
    assert.equal(campaign.email, CREATOR_EMAIL);
  });

  test('confirm with correct code logs creator in (session authorizes donations)', async () => {
    const startRes = await request(app)
      .post('/api/campaigns')
      .send(CREATION_FIELDS);

    const confirmRes = await request(app)
      .post('/api/campaigns/confirm')
      .send({ token: startRes.body.token, code: fakeEmail.lastCode });

    const sessionCookie = confirmRes.headers['set-cookie'].find(c => c.startsWith('__session='));
    const cookieValue = sessionCookie.split(';')[0];

    const donRes = await request(app)
      .post(`/api/donations/${NEW_SLUG}`)
      .set('Cookie', cookieValue)
      .send({ donorName: 'Bob', amount: '100', timestamp: new Date().toISOString() });

    assert.equal(donRes.status, 200);
    assert.equal(donRes.body.success, true);
  });

  test('confirm with wrong code returns 400 and does not create campaign', async () => {
    const startRes = await request(app)
      .post('/api/campaigns')
      .send(CREATION_FIELDS);

    const confirmRes = await request(app)
      .post('/api/campaigns/confirm')
      .send({ token: startRes.body.token, code: '000000' });

    assert.equal(confirmRes.status, 400);
    assert.equal(confirmRes.body.error, 'Invalid code');
    assert.equal(await fakeDb.getCampaign(NEW_SLUG), null);
  });

  test('confirm with expired token returns 400', async () => {
    const token = 'fake-expired-token';
    await fakeDb.setPendingSignup(token, {
      ...CREATION_FIELDS,
      codeHash: 'doesnotmatter',
      expiresAt: Date.now() - 1000,
      attemptCount: 0,
    });

    const confirmRes = await request(app)
      .post('/api/campaigns/confirm')
      .send({ token, code: '123456' });

    assert.equal(confirmRes.status, 400);
    assert.match(confirmRes.body.error, /expired/i);
  });

  test('confirm when slug taken at materialization returns 409', async () => {
    // Pre-create a real campaign with the same slug
    await fakeDb.setCampaign(NEW_SLUG, {
      id: 'existing-id', slug: NEW_SLUG, name: 'Existing', email: 'other@example.com',
      target_amount: 1000, currency: 'USD', accumulated_amount: 0, created_at: new Date().toISOString(),
    });

    const startRes = await request(app)
      .post('/api/campaigns')
      .send(CREATION_FIELDS);

    const confirmRes = await request(app)
      .post('/api/campaigns/confirm')
      .send({ token: startRes.body.token, code: fakeEmail.lastCode });

    assert.equal(confirmRes.status, 409);
    assert.match(confirmRes.body.error, /slug/i);
  });
});

describe('Member OTP login', () => {
  const MEMBER_EMAIL = 'member@example.com';
  let fakeDb;
  let fakeEmail;

  beforeEach(() => {
    fakeDb = createFakeDb({ [CAMPAIGN_SLUG]: { ...CAMPAIGN } });
    app.locals.firebase = fakeDb;
    fakeEmail = createFakeEmail();
    app.locals.email = fakeEmail;
  });

  test('otp/request with a member email sends OTP and returns neutral 200', async () => {
    await fakeDb.addMember(CAMPAIGN.id, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });

    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: MEMBER_EMAIL });

    assert.equal(res.status, 200);
    assert.equal(fakeEmail.callCount, 1);
    assert.equal(fakeEmail.lastCode?.length, 6);
  });

  test('otp/request with an email that is neither owner nor member sends nothing and returns neutral 200', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: 'unknown@example.com' });

    assert.equal(res.status, 200);
    assert.equal(fakeEmail.callCount, 0);
  });

  test('otp/verify for a member email produces a session with role member and correct email', async () => {
    await fakeDb.addMember(CAMPAIGN.id, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });

    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: MEMBER_EMAIL });

    const code = fakeEmail.lastCode;
    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: MEMBER_EMAIL, code });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);

    // Confirm session carries role: member
    const statusRes = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', verifyRes.headers['set-cookie']);

    assert.equal(statusRes.body.authenticated, true);
    assert.equal(statusRes.body.role, 'member');
  });

  test('otp/verify for the owner email still produces role organizer', async () => {
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: fakeEmail.lastCode });

    assert.equal(verifyRes.status, 200);

    const statusRes = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', verifyRes.headers['set-cookie']);

    assert.equal(statusRes.body.role, 'organizer');
  });

  test('auth/status returns role member for a member session cookie', async () => {
    const cookie = makeSessionCookie(CAMPAIGN.id, CAMPAIGN_SLUG, 'member', MEMBER_EMAIL);
    const res = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.equal(res.body.role, 'member');
  });

  test('concurrent OTP requests from owner and member use independent state', async () => {
    await fakeDb.addMember(CAMPAIGN.id, { email: MEMBER_EMAIL, added_at: new Date().toISOString() });

    // Both request OTPs; each email call is independent
    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL });
    const ownerCode = fakeEmail.lastCode;

    await request(app)
      .post('/api/auth/otp/request')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: MEMBER_EMAIL });
    const memberCode = fakeEmail.lastCode;

    // Codes are independent (different OTP state keys)
    assert.notEqual(ownerCode, memberCode);

    // Owner verifies with their code → organizer session
    const ownerVerify = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: ORGANIZER_EMAIL, code: ownerCode });
    assert.equal(ownerVerify.status, 200);

    // Member verifies with their code → member session
    const memberVerify = await request(app)
      .post('/api/auth/otp/verify')
      .send({ campaignSlug: CAMPAIGN_SLUG, email: MEMBER_EMAIL, code: memberCode });
    assert.equal(memberVerify.status, 200);

    const memberStatus = await request(app)
      .get(`/api/auth/status?slug=${CAMPAIGN_SLUG}`)
      .set('Cookie', memberVerify.headers['set-cookie']);
    assert.equal(memberStatus.body.role, 'member');
  });
});
