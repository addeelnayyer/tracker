// HTTP-level tests for the manual donation flows, run against the exported
// Express `app` with the firebase module replaced by an in-memory fake (no live
// RTDB). These lock in that the campaign accumulated total is maintained with
// atomic increments rather than a lossy read-modify-write.

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

beforeEach(() => {
  firebase.reset();
  seed();
});

describe('POST /api/donations/:slug (add)', () => {
  test('increments the campaign total by the donation amount', async () => {
    const res = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, donationId: expect.any(String) });
    expect(firebase.getStoredAmount(SLUG)).toBe(500);
  });

  test('accumulates across multiple donations from the starting total', async () => {
    firebase.reset();
    seed({ accumulated_amount: 1000 });

    await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 250, timestamp: '2026-01-01', ...creds });
    await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Grace', amount: 750, timestamp: '2026-01-02', ...creds });

    expect(firebase.getStoredAmount(SLUG)).toBe(2000);
  });

  test('rejects missing fields with 400', async () => {
    const res = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', ...creds });
    expect(res.status).toBe(400);
    expect(firebase.getStoredAmount(SLUG)).toBe(0);
  });

  test('rejects wrong credentials with 401 and does not change the total', async () => {
    const res = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', email: EMAIL, password: 'wrong' });
    expect(res.status).toBe(401);
    expect(firebase.getStoredAmount(SLUG)).toBe(0);
  });

  test('returns 404 for an unknown campaign', async () => {
    const res = await request(app)
      .post('/api/donations/nope')
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/donations/:slug/:id (edit)', () => {
  test('recomputes the total atomically when the amount changes', async () => {
    const add = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });
    const donationId = add.body.donationId;
    expect(firebase.getStoredAmount(SLUG)).toBe(500);

    const res = await request(app)
      .put(`/api/donations/${SLUG}/${donationId}`)
      .send({ donorName: 'Ada', amount: 800, timestamp: '2026-01-01', ...creds });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    // 500 removed, 800 added: net +300.
    expect(firebase.getStoredAmount(SLUG)).toBe(800);
  });

  test('lowering an amount decrements the total', async () => {
    const add = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });

    await request(app)
      .put(`/api/donations/${SLUG}/${add.body.donationId}`)
      .send({ donorName: 'Ada', amount: 200, timestamp: '2026-01-01', ...creds });

    expect(firebase.getStoredAmount(SLUG)).toBe(200);
  });

  test('returns 404 for an unknown donation', async () => {
    const res = await request(app)
      .put(`/api/donations/${SLUG}/missing`)
      .send({ donorName: 'Ada', amount: 800, timestamp: '2026-01-01', ...creds });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/donations/:slug/:id', () => {
  test('decrements the total by the donation amount', async () => {
    firebase.reset();
    seed({ accumulated_amount: 0 });
    const a = await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Ada', amount: 500, timestamp: '2026-01-01', ...creds });
    await request(app)
      .post(`/api/donations/${SLUG}`)
      .send({ donorName: 'Grace', amount: 300, timestamp: '2026-01-01', ...creds });
    expect(firebase.getStoredAmount(SLUG)).toBe(800);

    const res = await request(app)
      .delete(`/api/donations/${SLUG}/${a.body.donationId}`)
      .send(creds);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(firebase.getStoredAmount(SLUG)).toBe(300);
  });

  test('returns 404 for an unknown donation', async () => {
    const res = await request(app).delete(`/api/donations/${SLUG}/missing`).send(creds);
    expect(res.status).toBe(404);
  });
});

describe('concurrent total updates', () => {
  test('two concurrent donations do not lose an update', async () => {
    const post = (amount, name) =>
      request(app)
        .post(`/api/donations/${SLUG}`)
        .send({ donorName: name, amount, timestamp: '2026-01-01', ...creds });

    // Both requests read the same accumulated_amount snapshot (0) before either
    // writes. A read-modify-write of the total would clobber one of them; the
    // atomic increment must keep both.
    await Promise.all([post(100, 'A'), post(250, 'B')]);

    expect(firebase.getStoredAmount(SLUG)).toBe(350);
  });

  test('many concurrent donations all land', async () => {
    const amounts = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20 => 210
    await Promise.all(
      amounts.map((amount) =>
        request(app)
          .post(`/api/donations/${SLUG}`)
          .send({ donorName: `donor-${amount}`, amount, timestamp: '2026-01-01', ...creds })
      )
    );

    expect(firebase.getStoredAmount(SLUG)).toBe(210);
  });
});
