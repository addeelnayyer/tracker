// HTTP-level tests for the donor card-checkout slice (#5), run against the
// exported Express `app`. The firebase module is replaced by the in-memory fake
// and the Safepay client is stubbed at its require boundary — no live RTDB and
// no Safepay network calls. These lock in the server-side amount validation, the
// pending-donation record shape, the PUBLIC_BASE_URL-derived redirect URLs, and
// that pending donations never appear in public reads.

process.env.PUBLIC_BASE_URL = 'https://nasr.example';
process.env.SAFEPAY_ENV = 'sandbox';

jest.mock('../src/firebase', () => require('./helpers/fakeFirebase'));

// Stub the Safepay client: record what the route asked for and hand back a
// deterministic tracker + redirect URL without touching the network.
jest.mock('../src/safepay', () => ({
  createCheckoutSession: jest.fn(async (args) => ({
    tracker: 'track_TEST123',
    redirectUrl: `https://sandbox.api.getsafepay.com/embedded/?tracker=track_TEST123`,
    _args: args,
  })),
  toPaisa: (pkr) => Math.round(pkr * 100),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const firebase = require('./helpers/fakeFirebase');
const safepay = require('../src/safepay');
const app = require('../src/app');

const SLUG = 'save-the-bees';
const CAMPAIGN_ID = 'campaign-1';

const seed = (overrides = {}) =>
  firebase.seedCampaign({
    id: CAMPAIGN_ID,
    slug: SLUG,
    name: 'Save the Bees',
    email: 'organizer@example.test',
    password_hash: bcrypt.hashSync('correct-horse', 10),
    target_amount: 1000000,
    accumulated_amount: 0,
    ...overrides,
  });

const checkout = (body) =>
  request(app).post(`/api/payments/${SLUG}/checkout`).send(body);

const valid = { amount: 5000, donorName: 'Ada', email: 'ada@example.test' };

beforeEach(() => {
  firebase.reset();
  seed();
  safepay.createCheckoutSession.mockClear();
});

describe('POST /api/payments/:slug/checkout — pending creation', () => {
  test('creates a pending card donation and returns a redirect URL', async () => {
    const res = await checkout(valid);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.redirectUrl).toContain('track_TEST123');

    const donations = await firebase.getDonations(CAMPAIGN_ID);
    expect(donations).toHaveLength(1);
    expect(donations[0]).toMatchObject({
      payment_method: 'card',
      payment_status: 'pending',
      provider: 'safepay',
      provider_ref: 'track_TEST123',
      donor_email: 'ada@example.test',
      donor_name: 'Ada',
      amount: 5000,
    });
  });

  test('passes amount in PKR and PUBLIC_BASE_URL-derived redirect URLs to Safepay', async () => {
    await checkout(valid);

    expect(safepay.createCheckoutSession).toHaveBeenCalledTimes(1);
    const args = safepay.createCheckoutSession.mock.calls[0][0];
    expect(args.amountPkr).toBe(5000); // human PKR, conversion happens inside the client
    expect(args.successUrl).toContain('https://nasr.example');
    expect(args.cancelUrl).toContain('https://nasr.example');
    expect(args.successUrl).toContain(`/campaign/${SLUG}`);
  });

  test('name is optional (stored null when omitted)', async () => {
    const res = await checkout({ amount: 5000, email: 'anon@example.test' });
    expect(res.status).toBe(200);

    const donations = await firebase.getDonations(CAMPAIGN_ID);
    expect(donations[0].donor_name).toBeNull();
    expect(donations[0].donor_email).toBe('anon@example.test');
  });

  test('returns 404 for an unknown campaign and creates nothing', async () => {
    const res = await request(app)
      .post('/api/payments/nope/checkout')
      .send(valid);
    expect(res.status).toBe(404);
    expect(safepay.createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/:slug/checkout — validation', () => {
  const rejects = async (body) => {
    const res = await checkout(body);
    expect(res.status).toBe(400);
    // Nothing should be created and Safepay must not be called on bad input.
    expect(safepay.createCheckoutSession).not.toHaveBeenCalled();
    expect(await firebase.getDonations(CAMPAIGN_ID)).toHaveLength(0);
  };

  test('rejects amount below PKR 1,000', () => rejects({ ...valid, amount: 999 }));
  test('rejects amount above PKR 1,000,000', () => rejects({ ...valid, amount: 1000001 }));
  test('rejects a non-positive amount', () => rejects({ ...valid, amount: 0 }));
  test('rejects a negative amount', () => rejects({ ...valid, amount: -100 }));
  test('rejects a NaN amount', () => rejects({ ...valid, amount: 'abc' }));
  test('rejects more than two decimal places', () => rejects({ ...valid, amount: 1000.555 }));
  test('rejects a missing amount', () => rejects({ donorName: 'Ada', email: 'ada@example.test' }));
  test('rejects a missing email', () => rejects({ amount: 5000, donorName: 'Ada' }));

  test('accepts the minimum and maximum bounds', async () => {
    const min = await checkout({ ...valid, amount: 1000 });
    expect(min.status).toBe(200);
    firebase.reset();
    seed();
    const max = await checkout({ ...valid, amount: 1000000 });
    expect(max.status).toBe(200);
  });

  test('accepts up to two decimal places', async () => {
    const res = await checkout({ ...valid, amount: 1500.5 });
    expect(res.status).toBe(200);
    expect((await firebase.getDonations(CAMPAIGN_ID))[0].amount).toBe(1500.5);
  });
});

describe('pending donations are invisible in public reads', () => {
  test('a pending card donation is excluded from the public list, count, and total', async () => {
    // A confirmed manual donation should still show through.
    await firebase.addDonation(CAMPAIGN_ID, {
      donor_name: 'Grace',
      amount: 250,
      timestamp: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    await checkout(valid); // creates a pending donation

    const res = await request(app).get(`/api/campaigns/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body.donations_count).toBe(1);
    expect(res.body.donations.map((d) => d.donor_name)).toEqual(['Grace']);
    // Pending never touched the total in this slice.
    expect(res.body.accumulated_amount).toBe(0);
  });
});

describe('safepay.toPaisa (single conversion helper)', () => {
  test('converts whole and fractional PKR to integer paisa', () => {
    const real = jest.requireActual('../src/safepay');
    expect(real.toPaisa(1000)).toBe(100000);
    expect(real.toPaisa(1500.5)).toBe(150050);
    expect(real.toPaisa(0.01)).toBe(1);
  });
});
