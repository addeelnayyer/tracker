// HTTP-level tests for the signed Safepay webhook — the money path (#6). Run
// against the exported Express `app` with the firebase module replaced by the
// in-memory fake. The Safepay client is stubbed only for the checkout call (so
// no network is hit creating the pending donation); the webhook's HMAC-SHA512
// signature verification and amount assertion run for REAL — they live in the
// route, not the stubbable client, exactly so they are exercised here.
//
// Each test drives the pending->confirmed transition the way Safepay would: by
// POSTing a JSON event signed with the same SHA512/hex recipe the handler uses
// (ADR 0001), over the exact raw bytes.

const crypto = require('crypto');

const WEBHOOK_SECRET = 'whsec_test_shared_secret';
process.env.SAFEPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.SAFEPAY_ENV = 'sandbox';
process.env.PUBLIC_BASE_URL = 'https://nasr.example';

jest.mock('../src/firebase', () => require('./helpers/fakeFirebase'));

// Stub only the network-bound session setup; toPaisa stays faithful to the real
// helper so the route's amount assertion exercises the genuine conversion.
jest.mock('../src/safepay', () => ({
  createCheckoutSession: jest.fn(async () => ({
    tracker: 'track_TEST123',
    redirectUrl: 'https://sandbox.api.getsafepay.com/embedded/?tracker=track_TEST123',
  })),
  toPaisa: (pkr) => Math.round(pkr * 100),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const firebase = require('./helpers/fakeFirebase');
const app = require('../src/app');

const SLUG = 'save-the-bees';
const CAMPAIGN_ID = 'campaign-1';
const TRACKER = 'track_TEST123';
const AMOUNT_PKR = 5000;

const seed = () =>
  firebase.seedCampaign({
    id: CAMPAIGN_ID,
    slug: SLUG,
    name: 'Save the Bees',
    email: 'organizer@example.test',
    password_hash: bcrypt.hashSync('correct-horse', 10),
    target_amount: 1000000,
    accumulated_amount: 0,
  });

// Create the pending donation + payment_ref the way the donor checkout does.
const startCheckout = (amount = AMOUNT_PKR) =>
  request(app)
    .post(`/api/payments/${SLUG}/checkout`)
    .send({ amount, donorName: 'Ada', email: 'ada@example.test' });

const sign = (raw) =>
  crypto.createHmac('sha512', WEBHOOK_SECRET).update(raw).digest('hex');

const successEvent = (overrides = {}) => ({
  type: 'payment.succeeded',
  data: { tracker: TRACKER, state: 'PAID', amount: 100 * AMOUNT_PKR, ...overrides },
});

// Post a raw JSON webhook. By default it is correctly signed over the exact
// bytes; pass { signature } to forge/omit it, or { raw } to control the bytes.
const postWebhook = (event, { signature, raw } = {}) => {
  const body = raw !== undefined ? raw : JSON.stringify(event);
  const req = request(app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json');
  const sig = signature !== undefined ? signature : sign(body);
  if (sig !== null) req.set('X-SFPY-SIGNATURE', sig);
  return req.send(body);
};

const publicRead = () => request(app).get(`/api/campaigns/${SLUG}`);

beforeEach(() => {
  firebase.reset();
  seed();
});

describe('POST /api/payments/webhook — happy path confirm', () => {
  test('valid-signature webhook flips pending->confirmed and increments the total once', async () => {
    await startCheckout();
    // Pre-condition: pending, invisible, total untouched.
    expect(firebase.getStoredAmount(SLUG)).toBe(0);

    const res = await postWebhook(successEvent());
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);

    const donations = await firebase.getDonations(CAMPAIGN_ID);
    expect(donations).toHaveLength(1);
    expect(donations[0].payment_status).toBe('confirmed');
    expect(donations[0].timestamp).toBeTruthy(); // confirmation time set by the webhook

    expect(firebase.getStoredAmount(SLUG)).toBe(AMOUNT_PKR);
  });

  test('confirmed card donation appears in the public list, count, and total', async () => {
    await startCheckout();
    await postWebhook(successEvent());

    const res = await publicRead();
    expect(res.status).toBe(200);
    expect(res.body.donations_count).toBe(1);
    expect(res.body.donations.map((d) => d.donor_name)).toEqual(['Ada']);
    expect(res.body.accumulated_amount).toBe(AMOUNT_PKR);
  });
});

describe('POST /api/payments/webhook — idempotency', () => {
  test('a duplicate/redelivered webhook is a no-op (total does not change)', async () => {
    await startCheckout();

    const first = await postWebhook(successEvent());
    expect(first.body.confirmed).toBe(true);

    const second = await postWebhook(successEvent());
    expect(second.status).toBe(200);
    expect(second.body.confirmed).toBe(false);

    expect(firebase.getStoredAmount(SLUG)).toBe(AMOUNT_PKR); // incremented exactly once
    const res = await publicRead();
    expect(res.body.donations_count).toBe(1);
  });

  test('concurrent identical deliveries increment the total exactly once', async () => {
    await startCheckout();

    await Promise.all([postWebhook(successEvent()), postWebhook(successEvent())]);

    expect(firebase.getStoredAmount(SLUG)).toBe(AMOUNT_PKR);
    expect((await publicRead()).body.donations_count).toBe(1);
  });
});

describe('POST /api/payments/webhook — rejection paths', () => {
  test('bad signature returns 401 and records nothing', async () => {
    await startCheckout();

    const res = await postWebhook(successEvent(), { signature: 'deadbeef' });
    expect(res.status).toBe(401);

    expect(firebase.getStoredAmount(SLUG)).toBe(0);
    expect((await firebase.getDonations(CAMPAIGN_ID))[0].payment_status).toBe('pending');
  });

  test('missing signature header returns 401 and records nothing', async () => {
    await startCheckout();

    const res = await postWebhook(successEvent(), { signature: null });
    expect(res.status).toBe(401);
    expect(firebase.getStoredAmount(SLUG)).toBe(0);
  });

  test('unknown tracker returns 200 and records nothing', async () => {
    await startCheckout();

    const res = await postWebhook(successEvent({ tracker: 'track_UNKNOWN' }));
    expect(res.status).toBe(200);

    expect(firebase.getStoredAmount(SLUG)).toBe(0);
    expect((await firebase.getDonations(CAMPAIGN_ID))[0].payment_status).toBe('pending');
  });

  test('amount mismatch is rejected without confirming', async () => {
    await startCheckout();

    // Signed correctly, but the event amount does not equal the pending record.
    const res = await postWebhook(successEvent({ amount: 100 * 9999 }));
    expect(res.status).toBe(400);

    expect(firebase.getStoredAmount(SLUG)).toBe(0);
    expect((await firebase.getDonations(CAMPAIGN_ID))[0].payment_status).toBe('pending');
  });

  test('a non-success (e.g. created) event does not confirm', async () => {
    await startCheckout();

    const res = await postWebhook({
      type: 'payment.created',
      data: { tracker: TRACKER, state: 'TRACKER_STARTED', amount: 100 * AMOUNT_PKR },
    });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(false);

    expect(firebase.getStoredAmount(SLUG)).toBe(0);
    expect((await firebase.getDonations(CAMPAIGN_ID))[0].payment_status).toBe('pending');
  });
});

describe('POST /api/payments/simulate-webhook — sandbox-only', () => {
  test('confirms a pending donation without a signed payload', async () => {
    await startCheckout();

    const res = await request(app)
      .post('/api/payments/simulate-webhook')
      .send({ tracker: TRACKER });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
    expect(firebase.getStoredAmount(SLUG)).toBe(AMOUNT_PKR);
  });

  test('is disabled (404) when SAFEPAY_ENV is production', async () => {
    await startCheckout();
    process.env.SAFEPAY_ENV = 'production';
    try {
      const res = await request(app)
        .post('/api/payments/simulate-webhook')
        .send({ tracker: TRACKER });
      expect(res.status).toBe(404);
      expect(firebase.getStoredAmount(SLUG)).toBe(0); // nothing confirmed
    } finally {
      process.env.SAFEPAY_ENV = 'sandbox';
    }
  });
});
