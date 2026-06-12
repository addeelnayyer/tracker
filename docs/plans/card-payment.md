# Plan: Card Payment (Safepay) — real online donation collection

## Summary

Add real online card collection to the campaign tracker via **Safepay**, with the
platform acting as **merchant of record** (all cards charge into one platform Safepay
account). A public donor can pay by card directly on a campaign page; on a signed
Safepay webhook the donation is recorded and the campaign total is incremented exactly
once. Card and manual donations coexist in the same list and total, tagged by
`payment_method`.

This is the first time **money actually moves through the system** and the first time a
donation can be created **without organizer authentication** — the webhook signature is
the trust boundary.

## Decisions (locked)

| # | Decision |
|---|----------|
| 1 | Feature = real online collection (not display-only, not a label). |
| 2 | Money model = **platform-as-merchant**: one Safepay account, money pools with the platform. |
| 3 | Processor = **Safepay** (hosted checkout + signed webhooks, PKR, card-first). |
| 4 | Public "Donate by Card" flow; card + manual donations share one list/total, separated by `payment_method`. Donor: **name optional, email required**, amount required. |
| 5 | Lifecycle = **pending-first**: create a `pending` record at checkout start keyed by Safepay tracker id; **webhook flips to `confirmed`** and bumps the total. Public views show `confirmed` only. |
| 6 | Idempotency via the pending record (`pending → confirmed` is the only state that bumps); the confirm+increment runs in an **RTDB transaction**. **Manual path also converted to atomic increments.** |
| 7 | Webhook auth = **HMAC signature verification** on the raw body against `SAFEPAY_WEBHOOK_SECRET`; assert tracker id + amount match the pending record before confirming. Bad signature → 401. Unknown tracker → **200 + no-op**. |
| 8 | **Gross accounting** (record/total = donor-paid amount; fees off-system). **Single-point** PKR→Safepay-unit conversion. Server-side bounds **min PKR 1000 / max PKR 1,000,000**, finite, >0, ≤2 decimals. |
| 9 | All Safepay config via **env** (one platform account); `PUBLIC_BASE_URL` for redirect/webhook URLs; **sandbox by default**. Support **both** an ngrok tunnel and a sandbox-only "simulate webhook" dev endpoint. |
| 10 | v1: card amount **immutable** (display name editable), **no delete** of confirmed card donations, **refunds/chargebacks out of scope** (Safepay dashboard). |
| 11 | v1: donor **success/cancel pages** (pending-aware messaging) + real-time list/total update. **Receipts & organizer notifications deferred.** |
| 12 | Card is **primary CTA**, bank-transfer details secondary. Card `timestamp` = confirm time. Abandoned `pending` records **left as-is** (cleanup deferred). **Disbursement to organizers is manual/off-system, out of scope.** |

## Data model changes

Donation record (RTDB `donations/{campaignId}/{donationId}`) gains:

- `payment_method`: `'manual' | 'card'` (existing records treated as `manual`)
- `payment_status`: `'pending' | 'confirmed' | 'failed'` (manual = always `confirmed`)
- `provider`: `'safepay'` (card only)
- `provider_ref`: Safepay tracker/session id (card only) — correlation + idempotency key
- `donor_email`: string (card; required)
- existing `amount`, `donor_name` (fallback `'Anonymous'`), `timestamp`, `created_at`

Public reads (campaign view, total, list) **filter to `payment_status === 'confirmed'`**.

## Backend work

1. **`src/payments/safepay.js`** (new) — thin Safepay client: create checkout session,
   verify webhook signature, the **single** PKR→Safepay-unit conversion helper, env-driven
   sandbox/production base URL. (Confirm exact amount unit + signature scheme against
   current Safepay docs during implementation.)

2. **`src/routes/payments.js`** (new):
   - `POST /api/payments/:campaignSlug/checkout` — public. Validate amount bounds + email;
     create a `pending` donation; create a Safepay session with success/cancel URLs built
     from `PUBLIC_BASE_URL`; store tracker id on the pending record; return the redirect URL.
   - `POST /api/payments/safepay/webhook` — public, **`express.raw()` body**. Verify HMAC
     signature; load pending record by tracker id (unknown → 200 no-op); assert amount
     matches; run RTDB transaction: if already `confirmed` → no-op, else flip to
     `confirmed` + atomically increment `accumulated_amount`. Always 200 on valid-but-handled.
   - `POST /api/payments/safepay/simulate` — **sandbox-only**, guarded off in production;
     replays a webhook locally without a tunnel.
   - Success/cancel redirect handlers (or static pages) with pending-aware messaging.

3. **`src/firebase.js`** — add:
   - `addPendingDonation`, `getDonationByProviderRef`
   - `confirmDonationAndIncrement(campaignId, donationId, slug, amount)` — RTDB transaction,
     idempotent.
   - Convert `updateCampaignAmount` usages on the **manual** path (`donations.js`) to atomic
     increments / transactions (delete + edit recompute included).

4. **`src/app.js`** — mount the webhook route with raw body **before** global `express.json()`
   so signature verification sees exact bytes; mount `payments.js`.

5. **Guards on existing `donations.js`** — reject edit of `amount` and reject delete when
   `payment_method === 'card'` (name edits still allowed).

## Frontend work (`views/campaign.html`, `public/js/app.js`, `public/css/style.css`)

- Public **"Donate by Card"** primary CTA: amount, optional name, required email →
  POST checkout → redirect to Safepay.
- Bank-details panel demoted to a secondary "or transfer directly" section.
- Success/cancel landing states ("payment received / confirming…" vs "didn't go through").
- Confirmed card donations appear in the existing real-time list with a card indicator.

## Config (`.env.example`, `set-firebase-env.sh`, functions config)

`SAFEPAY_ENV` (`sandbox`|`production`), `SAFEPAY_API_KEY`, `SAFEPAY_SECRET_KEY`,
`SAFEPAY_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`. Never in DB, never client-side.

## Explicitly out of scope for v1

Refunds/chargebacks (Safepay dashboard), donor email receipts, organizer notifications,
in-app disbursement/payout tracking, abandoned-`pending` cleanup job, wallet methods
(JazzCash/Easypaisa). Each is a noted follow-up.

## Key risks / footguns

- Raw-body ordering vs `express.json()` — get this wrong and signatures never validate.
- Redirect is **not** proof of payment — only the signed webhook confirms.
- `accumulated_amount` read-modify-write is a pre-existing race; the card path **requires**
  atomic increments under public concurrency (manual path converted too).
- Verify Safepay's exact amount unit (PKR vs paisa) and signature algorithm against live
  docs before wiring — assumptions here cause silent 100x errors or 401 loops.
</content>
</invoke>
