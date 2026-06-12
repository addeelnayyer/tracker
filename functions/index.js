const { onRequest } = require('firebase-functions/v2/https');
const app = require('../src/app');

// Secrets are fetched from Secret Manager and injected into process.env at runtime.
// Non-sensitive vars (PROJECT_ID, DATABASE_URL, etc.) come from .env via the deploy bundle.
const SECRETS = [
  'SA_PRIVATE_KEY',
  'SA_PRIVATE_KEY_ID',
  'SA_CLIENT_EMAIL',
  'SA_CLIENT_ID',
  'SESSION_SECRET',
  // Safepay — sensitive, injected from Secret Manager (ADR 0001). The merchant
  // API/secret keys sign session setup; the endpoint shared secret verifies
  // webhook HMACs. SAFEPAY_ENV and PUBLIC_BASE_URL stay in .env (non-sensitive).
  'SAFEPAY_API_KEY',
  'SAFEPAY_SECRET_KEY',
  'SAFEPAY_WEBHOOK_SECRET',
];

exports.api = onRequest({ region: 'us-central1', secrets: SECRETS, invoker: 'public' }, app);
