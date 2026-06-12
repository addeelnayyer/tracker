// Safepay client. Wraps the Safepay hosted-checkout "session setup" API and the
// PKR -> paisa amount conversion so the rest of the app never talks to Safepay
// directly and the HTTP tests can stub this whole module at its require
// boundary. See docs/adr/0001-safepay-integration-facts.md for the integration
// facts this encodes: amount unit is paisa, the per-env hosts, and the
// `x-sfpy-merchant-secret` auth header for `authType: 'secret'`.

// Per-environment hosts. `api` is the REST host the session is created against;
// `checkout` is where the donor is redirected to enter card details.
const HOSTS = {
  sandbox: {
    api: 'https://sandbox.api.getsafepay.com',
    checkout: 'https://sandbox.api.getsafepay.com/embedded',
  },
  production: {
    api: 'https://api.getsafepay.com',
    checkout: 'https://getsafepay.com/embedded',
  },
};

// Default to sandbox unless explicitly in production (PRD: sandbox by default).
const environment = () =>
  process.env.SAFEPAY_ENV === 'production' ? 'production' : 'sandbox';

const hosts = () => HOSTS[environment()];

// THE single PKR -> paisa conversion point (ADR 0001). Safepay amounts are in
// the smallest denomination: PKR 1,000 -> 100000 paisa. Never scatter `* 100`
// anywhere else — bounds and stored amounts stay in human PKR.
const toPaisa = (pkr) => Math.round(pkr * 100);

// Create a Safepay hosted-checkout session for `amountPkr` and return the
// tracker id (our correlation / idempotency key) plus the URL to redirect the
// donor to. Network call — stubbed in tests.
//
// NOTE: the exact session-setup body fields and tracker response path are
// confirmed against a live Safepay sandbox during the webhook slice (#6 / ADR
// "Open / to confirm"); they are isolated here behind this one function so a
// correction touches nothing else.
async function createCheckoutSession({ amountPkr, donorEmail, donorName, successUrl, cancelUrl }) {
  const secret = process.env.SAFEPAY_SECRET_KEY;
  const apiKey = process.env.SAFEPAY_API_KEY;
  if (!secret || !apiKey) {
    throw new Error('Safepay is not configured (SAFEPAY_API_KEY / SAFEPAY_SECRET_KEY)');
  }

  const response = await fetch(`${hosts().api}/order/payments/v3/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sfpy-merchant-secret': secret,
    },
    body: JSON.stringify({
      merchant_api_key: apiKey,
      intent: 'CYBERSOURCE',
      mode: 'payment',
      currency: 'PKR',
      amount: toPaisa(amountPkr),
      metadata: { donor_email: donorEmail, donor_name: donorName || null },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Safepay session setup failed (${response.status}): ${detail}`.trim());
  }

  const body = await response.json();
  const tracker = body?.data?.tracker?.token || body?.data?.token || body?.tracker;
  if (!tracker) {
    throw new Error('Safepay session setup returned no tracker id');
  }

  return { tracker, redirectUrl: buildCheckoutUrl({ tracker, successUrl, cancelUrl }) };
}

// Build the hosted-checkout URL the donor is sent to. `redirect_url`/`cancel_url`
// are where Safepay returns the donor after pay/cancel — built by the caller
// from PUBLIC_BASE_URL, never guessed from the request host.
function buildCheckoutUrl({ tracker, successUrl, cancelUrl }) {
  const params = new URLSearchParams({ tracker, env: environment(), source: 'custom' });
  if (successUrl) params.set('redirect_url', successUrl);
  if (cancelUrl) params.set('cancel_url', cancelUrl);
  return `${hosts().checkout}/?${params.toString()}`;
}

module.exports = { toPaisa, createCheckoutSession, environment };
