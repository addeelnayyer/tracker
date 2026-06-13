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
  const donations = new Map();

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
    async addDonation(campaignId, data) {
      const id = `don-${Date.now()}`;
      if (!donations.has(campaignId)) donations.set(campaignId, []);
      donations.get(campaignId).push({ id, ...data });
      return id;
    },
    async updateCampaignAmount(slug, amount) {
      const c = campaigns.get(slug);
      if (c) c.accumulated_amount = amount;
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

const CAMPAIGN_SLUG = 'test-campaign';
const ORGANIZER_EMAIL = 'organizer@example.com';
const CAMPAIGN = {
  id: 'campaign-id-1',
  email: ORGANIZER_EMAIL,
  slug: CAMPAIGN_SLUG,
  accumulated_amount: 0,
};

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
