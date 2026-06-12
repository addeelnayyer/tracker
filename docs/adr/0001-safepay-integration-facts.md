# 0001 — Safepay integration: amount unit, webhook signature, and Cloud Functions raw body

- **Status:** Accepted
- **Date:** 2026-06-13
- **Resolves:** [#4](https://github.com/addeelnayyer/tracker/issues/4) (spike). Unblocks [#6](https://github.com/addeelnayyer/tracker/issues/6) (signed webhook) and informs [#5](https://github.com/addeelnayyer/tracker/issues/5) (checkout).
- **Context source:** Safepay official docs + `@sfpy/node-core`; firebase-functions v2 runtime behavior. See "References" below.

## Context

The Card Payment feature (PRD [#1](https://github.com/addeelnayyer/tracker/issues/1)) makes money move through the system for the first time. Three facts had to be pinned down before any webhook/checkout code can be trusted in production, because each fails *silently* when wrong:

1. The exact amount unit Safepay expects (a 100x error if wrong).
2. The webhook signature algorithm and signed payload (a 401 loop, or worse, an accepted forgery, if wrong).
3. How the webhook handler obtains the **exact raw request bytes** on Cloud Functions, where the runtime parses the body before our Express app sees it.

This app runs as a single 2nd-gen Cloud Function (`onRequest`) wrapping the Express app, fronted by Firebase Hosting rewrites. Locally it runs as a plain `node` process. `src/app.js` deliberately skips its own body parsing when `K_SERVICE` is set, because the functions runtime already consumed/parsed the stream.

## Decision

### 1. Amount unit — paisa (smallest denomination)

Safepay represents amounts in the **lowest denomination**: "PKR is represented in paisas, USD in cents...". So **PKR 1000 → `100000`** (integer paisa).

- Store the human **PKR** value on the donation record (gross, per PRD).
- Convert to paisa in **exactly one helper** at session-creation time: `paisa = Math.round(pkr * 100)`. Never scatter `* 100`.
- Validation bounds are expressed and checked in **PKR** before conversion: min PKR 1,000 (`100000` paisa), max PKR 1,000,000 (`100000000` paisa), finite, > 0, ≤ 2 decimals.
- The webhook `notification.amount` is also paisa — assert it equals the pending record's amount converted to paisa before confirming.

### 2. Webhook signature — HMAC-SHA512 over the raw JSON payload

> ⚠️ This is **not** the same mechanism as the success-page *redirect* signature. The redirect uses `HMAC-SHA256(tracker, secret)` in the `sig` query/body field (`verify.signature`). We do **not** rely on the redirect for confirmation, so we do **not** depend on that one. The **webhook** is the source of truth and uses a different algorithm:

- **Algorithm:** `HMAC-SHA512`, hex digest.
- **Signed data:** the **raw webhook request body bytes** (the JSON payload as received, not re-serialized).
- **Secret:** the endpoint's **shared secret** (Safepay Dashboard → Developers → Endpoints → "View shared secret"). Sandbox and Live have **different** secrets. Stored as `SAFEPAY_WEBHOOK_SECRET`.
- **Signature header:** `X-SFPY-SIGNATURE` (read case-insensitively via `req.headers['x-sfpy-signature']`).
- **Verification:** prefer the SDK helper `safepay.webhooks.constructEvent(rawBody, signature, webhookSecret)`, which verifies **and** parses, throwing on failure (handle via try/catch → 401). Equivalent manual check:
  ```js
  const expected = crypto.createHmac('sha512', SAFEPAY_WEBHOOK_SECRET)
    .update(rawBody)            // Buffer of exact bytes
    .digest('hex');
  // timing-safe compare against the X-SFPY-SIGNATURE header
  ```
- Tests compute expected signatures with the same SHA512/hex recipe to drive the stubbed webhook (no network).

### 3. Raw body — use `req.rawBody`, made uniform across environments

firebase-functions' `onRequest` augments the Express request with **`req.rawBody` (a `Buffer` of the wire-format body)**, available **even though** `req.body` is also parsed. This is the clean resolution to the "biggest risk": on Cloud Functions the raw bytes are **not** lost — they are on `req.rawBody`.

- **On Cloud Functions:** the webhook handler verifies the signature against `req.rawBody`. No change to the existing `K_SERVICE` body-parsing skip is required.
- **Locally** (`node`, no `K_SERVICE`): `req.rawBody` does **not** exist by default. To keep the handler identical in both environments, add a `verify` callback to the local body-parser that stashes the buffer: `verify: (req, _res, buf) => { req.rawBody = buf; }`. The webhook handler then always reads `req.rawBody`.
- **Do not** mount a competing `express.raw()` only for the webhook and fight the global JSON parser — using the runtime-provided `req.rawBody` (plus the local `verify` shim) is simpler and avoids the classic "Unexpected token o in JSON" body-parser conflict.

## Consequences

- The webhook handler is environment-agnostic: always `req.rawBody` + `X-SFPY-SIGNATURE` + SHA512.
- One conversion helper (`pkr → paisa`) is the only place unit math lives; bounds stay in PKR.
- **Deployment:** `SAFEPAY_SECRET_KEY` and `SAFEPAY_WEBHOOK_SECRET` are sensitive → add to the `SECRETS` array in `functions/index.js` (Secret Manager injection). `SAFEPAY_API_KEY` (merchant API key, used for session setup) is also sensitive and should be treated the same. `SAFEPAY_ENV` (`sandbox`|`production`) and `PUBLIC_BASE_URL` are non-sensitive `.env` values bundled at deploy.
- **SDK choice:** use `@sfpy/node-core` (`authType: 'secret'`, host `https://sandbox.api.getsafepay.com` vs `https://api.getsafepay.com` by `SAFEPAY_ENV`) for both `payments.session.setup` and `webhooks.constructEvent`.
- The sandbox/live secret split means env must drive **both** host and which webhook secret is in use; a sandbox secret will never validate a live event and vice-versa.

## Open / to confirm during implementation

- Exact webhook event **type** strings to switch on (e.g. `payment.succeeded`) and the precise `notification` field carrying the tracker we keyed the pending record by — confirm against a real sandbox event payload.
- Whether `constructEvent` expects the signature as hex (docs example implies hex); if the SDK and dashboard disagree on encoding, fall back to the manual SHA512/hex compare above.

## References

- Safepay — Money / amount units: https://safepay-docs.netlify.app/concepts/money
- Safepay — Webhooks overview: https://safepay-docs.netlify.app/developers/webhooks/overview
- Safepay — Verify HMAC signatures: https://safepay-docs.netlify.app/developers/webhooks/verify-hmac-signatures
- Safepay — Advanced checkout: https://safepay-docs.netlify.app/build-your-integration/advanced-checkout/introduction/
- Safepay Node SDK: https://github.com/getsafepay/safepay-node
- firebase-functions `https.Request.rawBody` (Buffer): https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.https.request
- Raw body for webhooks on Firebase Functions (prior art): https://www.bitesite.ca/blog/raw-body-for-stripe-webhooks-using-firebase-cloud-functions
</content>
