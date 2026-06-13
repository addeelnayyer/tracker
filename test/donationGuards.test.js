// HTTP-level tests for the organizer card-donation immutability guards (#8).
// A card donation is real money that actually moved through Safepay, so the
// organizer can no longer edit its amount or delete it once confirmed — either
// would desync the recorded campaign total from money that genuinely moved.
// Editing the donor display name stays allowed (typo fix / mark anonymous), and
// manual donations keep full edit/delete behavior.
//
// Runs against the exported Express `app` with the firebase module replaced by
// the in-memory fake (no live RTDB).

jest.mock('../src/firebase', () => require('./helpers/fakeFirebase'));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const firebase = require('./helpers/fakeFirebase');
const app = require('../src/app');

const EMAIL = 'organizer@example.test';
const PASSWORD = 'correct-horse';
const SLUG = 'save-the-bees';
const CAMPAIGN_ID = 'campaign-1';

const seed = (overrides = {}) =>
  firebase.seedCampaign({
    id: CAMPAIGN_ID,
    slug: SLUG,
    name: 'Save the Bees',
    email: EMAIL,
    password_hash: bcrypt.hashSync(PASSWORD, 10),
    target_amount: 1000000,
    accumulated_amount: 0,
    ...overrides,
  });

const creds = { email: EMAIL, password: PASSWORD };

// A confirmed card donation: written pending (does not count), then flipped to
// confirmed by the same transactional path the webhook uses, which credits the
// campaign total exactly once.
async function seedConfirmedCard({ amount = 5000, name = 'Card Donor' } = {}) {
  const id = await firebase.addDonation(CAMPAIGN_ID, {
    donor_name: name,
    amount,
    payment_method: 'card',
    payment_status: 'pending',
    provider: 'safepay',
    provider_ref: `track-${amount}`,
    created_at: '2026-01-01T00:00:00.000Z',
  });
  await firebase.confirmCardDonation(SLUG, CAMPAIGN_ID, id, '2026-01-02T00:00:00.000Z');
  return id;
}

// A pending card donation (abandoned checkout): never contributes to the total.
async function seedPendingCard({ amount = 5000, name = 'Pending Donor' } = {}) {
  return firebase.addDonation(CAMPAIGN_ID, {
    donor_name: name,
    amount,
    payment_method: 'card',
    payment_status: 'pending',
    provider: 'safepay',
    provider_ref: `pending-${amount}`,
    created_at: '2026-01-01T00:00:00.000Z',
  });
}

const findDonation = async (id) =>
  (await firebase.getDonations(CAMPAIGN_ID)).find((d) => d.id === id);

beforeEach(() => {
  firebase.reset();
  seed();
});

describe('PUT /api/donations/:slug/:id — card donation amount is immutable', () => {
  test('rejects an amount edit on a card donation and changes nothing', async () => {
    const id = await seedConfirmedCard({ amount: 5000, name: 'Ada' });
    expect(firebase.getStoredAmount(SLUG)).toBe(5000);

    const res = await request(app)
      .put(`/api/donations/${SLUG}/${id}`)
      .send({ donorName: 'Ada', amount: 9999, timestamp: '2026-01-02', ...creds });

    expect(res.status).toBe(403);
    const donation = await findDonation(id);
    expect(donation.amount).toBe(5000); // unchanged
    expect(firebase.getStoredAmount(SLUG)).toBe(5000); // total untouched
  });

  test('allows editing the display name of a card donation (same amount)', async () => {
    const id = await seedConfirmedCard({ amount: 5000, name: 'Anon' });

    const res = await request(app)
      .put(`/api/donations/${SLUG}/${id}`)
      .send({ donorName: 'Grace Hopper', amount: 5000, timestamp: '2026-01-02', ...creds });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const donation = await findDonation(id);
    expect(donation.donor_name).toBe('Grace Hopper');
    expect(donation.amount).toBe(5000); // amount preserved
    expect(firebase.getStoredAmount(SLUG)).toBe(5000); // total untouched
  });
});

describe('DELETE /api/donations/:slug/:id — confirmed card donation is undeletable', () => {
  test('rejects deletion of a confirmed card donation and keeps the total', async () => {
    const id = await seedConfirmedCard({ amount: 5000 });
    expect(firebase.getStoredAmount(SLUG)).toBe(5000);

    const res = await request(app).delete(`/api/donations/${SLUG}/${id}`).send(creds);

    expect(res.status).toBe(403);
    expect(await findDonation(id)).toBeDefined(); // still present
    expect(firebase.getStoredAmount(SLUG)).toBe(5000); // total untouched
  });

  test('allows deleting a pending card donation without decrementing the total', async () => {
    // A pending donation never counted toward the total, so removing an
    // abandoned checkout must not subtract its amount.
    const id = await seedPendingCard({ amount: 5000 });
    expect(firebase.getStoredAmount(SLUG)).toBe(0);

    const res = await request(app).delete(`/api/donations/${SLUG}/${id}`).send(creds);

    expect(res.status).toBe(200);
    expect(await findDonation(id)).toBeUndefined();
    expect(firebase.getStoredAmount(SLUG)).toBe(0); // not driven negative
  });
});

describe('manual donations keep full edit/delete behavior', () => {
  test('manual amount edit still recomputes the total', async () => {
    const add = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });
    const id = add.body.donationId;

    const res = await request(app)
      .put(`/api/donations/${SLUG}/${id}`)
      .send({ donorName: 'Ada', amount: 800, timestamp: '2026-01-01', ...creds });

    expect(res.status).toBe(200);
    expect(firebase.getStoredAmount(SLUG)).toBe(800);
  });

  test('manual donation delete still decrements the total', async () => {
    const add = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });

    const res = await request(app)
      .delete(`/api/donations/${SLUG}/${add.body.donationId}`)
      .send(creds);

    expect(res.status).toBe(200);
    expect(firebase.getStoredAmount(SLUG)).toBe(0);
  });
});
